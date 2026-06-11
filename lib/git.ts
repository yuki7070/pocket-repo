import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorktreeContext = {
  repoRoot: string;
  repoName: string;
  worktreeRelative: string;
  branch: string | null;
  isMainWorktree: boolean;
};

// Resolve the main repository a path belongs to, plus its worktree position.
// For a linked worktree, the git common dir points at the main repo's `.git`,
// so its parent is the main repository root.
export async function getWorktreeContext(
  repositoryPath: string
): Promise<WorktreeContext> {
  const fallback: WorktreeContext = {
    repoRoot: repositoryPath,
    repoName: path.basename(repositoryPath),
    worktreeRelative: "",
    branch: null,
    isMainWorktree: true
  };

  if (!repositoryPath || !existsSync(repositoryPath)) {
    return fallback;
  }

  try {
    const [topLevel, commonDir] = await Promise.all([
      git(repositoryPath, ["rev-parse", "--show-toplevel"]),
      git(repositoryPath, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir"
      ])
    ]);

    const worktreeRoot = topLevel.trim();
    const trimmedCommonDir = commonDir.trim();
    const repoRoot = trimmedCommonDir.endsWith("/.git")
      ? path.dirname(trimmedCommonDir)
      : worktreeRoot;
    const worktreeRelative =
      worktreeRoot === repoRoot ? "" : path.relative(repoRoot, worktreeRoot);

    let branch: string | null = null;
    try {
      branch =
        (await git(repositoryPath, ["branch", "--show-current"])).trim() || null;
    } catch {
      branch = null;
    }

    return {
      repoRoot,
      repoName: path.basename(repoRoot),
      worktreeRelative,
      branch,
      isMainWorktree: worktreeRoot === repoRoot
    };
  } catch {
    return fallback;
  }
}

export type RepositorySummary = {
  currentBranch: string;
  branchCount: number;
  worktreeCount: number;
  dirty: boolean;
  changedFileCount: number;
};

export type WorktreeSummary = {
  path: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
  detached: boolean;
};

export async function getRepositorySummary(repositoryPath: string) {
  const [currentBranch, branches, statusEntries, worktrees] = await Promise.all([
    git(repositoryPath, ["branch", "--show-current"]),
    git(repositoryPath, ["branch", "--format=%(refname:short)"]),
    git(repositoryPath, ["status", "--porcelain=v1", "-z"]),
    listWorktrees(repositoryPath)
  ]);

  const branchList = branches
    .split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean);
  const changedFileCount = statusEntries
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean).length;

  const activeBranch = currentBranch.trim() || "detached";

  return {
    currentBranch: activeBranch,
    branchCount:
      branchList.length === 0 && activeBranch !== "detached"
        ? 1
        : branchList.length,
    worktreeCount: worktrees.length,
    dirty: changedFileCount > 0,
    changedFileCount
  } satisfies RepositorySummary;
}

export type StatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
};

export async function getStatusEntries(repositoryPath: string) {
  const output = await git(repositoryPath, ["status", "--porcelain=v1", "-z"]);
  const tokens = output.split("\0");
  const entries: StatusEntry[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token) {
      continue;
    }

    const indexStatus = token[0];
    const worktreeStatus = token[1];
    const filePath = token.slice(3);

    // Rename/copy entries carry the original path in the next NUL token.
    if (indexStatus === "R" || indexStatus === "C") {
      index += 1;
    }

    entries.push({
      path: filePath,
      indexStatus,
      worktreeStatus,
      untracked: indexStatus === "?"
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listBranches(repositoryPath: string) {
  const output = await git(repositoryPath, [
    "branch",
    "--format=%(refname:short)"
  ]);

  return output
    .split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean);
}

// Files that differ between a base branch and the current HEAD, using the
// merge-base (three-dot) range to match the usual "compare branch" view.
export async function getDiffEntries(repositoryPath: string, base: string) {
  const output = await git(repositoryPath, [
    "diff",
    "--name-status",
    "-z",
    `${base}...HEAD`
  ]);
  const tokens = output.split("\0");
  const entries: StatusEntry[] = [];

  let index = 0;
  while (index < tokens.length) {
    const statusToken = tokens[index];

    if (!statusToken) {
      index += 1;
      continue;
    }

    const code = statusToken[0];

    // Rename/copy entries carry both the old and new path.
    if (code === "R" || code === "C") {
      const newPath = tokens[index + 2];
      if (newPath) {
        entries.push({
          path: newPath,
          indexStatus: code,
          worktreeStatus: " ",
          untracked: false
        });
      }
      index += 3;
      continue;
    }

    const filePath = tokens[index + 1];
    if (filePath) {
      entries.push({
        path: filePath,
        indexStatus: code,
        worktreeStatus: " ",
        untracked: false
      });
    }
    index += 2;
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function searchFileNames(
  repositoryPath: string,
  query: string,
  limit = 200
) {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    return [] as string[];
  }

  const output = await git(repositoryPath, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard"
  ]);
  const files = Array.from(
    new Set(
      output
        .split("\0")
        .map((file) => file.trim())
        .filter(Boolean)
    )
  );

  return files
    .filter((file) => file.toLowerCase().includes(trimmed))
    .slice(0, limit);
}

export async function listWorktrees(repositoryPath: string) {
  const output = await git(repositoryPath, ["worktree", "list", "--porcelain"]);
  const records = output
    .split("\n\n")
    .map((record) => record.trim())
    .filter(Boolean);

  return records.map(parseWorktreeRecord);
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024 * 10
  });

  return stdout;
}

function parseWorktreeRecord(record: string) {
  const summary: WorktreeSummary = {
    path: "",
    branch: null,
    head: null,
    bare: false,
    detached: false
  };

  for (const line of record.split("\n")) {
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");

    if (key === "worktree") {
      summary.path = value;
    }

    if (key === "HEAD") {
      summary.head = value;
    }

    if (key === "branch") {
      summary.branch = value.replace(/^refs\/heads\//, "");
    }

    if (key === "bare") {
      summary.bare = true;
    }

    if (key === "detached") {
      summary.detached = true;
    }
  }

  return summary;
}
