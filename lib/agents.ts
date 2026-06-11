import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CODEX_RUNNING_THRESHOLD_MS = 120_000;
const CODEX_RECENT_DAYS = 3;
const CODEX_SESSION_LIMIT = 50;

export type AgentSession = {
  tool: "claude" | "codex";
  id: string;
  name: string | null;
  pid: number | null;
  cwd: string;
  repoRoot: string;
  repoName: string;
  worktreeRelative: string;
  branch: string | null;
  status: string | null;
  running: boolean;
  startedAt: number | null;
  updatedAt: number | null;
};

export async function listAgentSessions() {
  const [claudeSessions, codexSessions] = await Promise.all([
    listClaudeSessions(),
    listCodexSessions()
  ]);

  const sessions = [...claudeSessions, ...codexSessions];

  const uniqueCwds = Array.from(
    new Set(sessions.map((session) => session.cwd).filter(Boolean))
  );
  const contextEntries = await Promise.all(
    uniqueCwds.map(async (cwd) => [cwd, await getRepoContext(cwd)] as const)
  );
  const contextByCwd = new Map(contextEntries);

  for (const session of sessions) {
    const context = contextByCwd.get(session.cwd);
    if (context) {
      session.repoRoot = context.repoRoot;
      session.repoName = context.repoName;
      session.worktreeRelative = context.worktreeRelative;
      session.branch = context.branch;
    }
  }

  return sessions.sort((a, b) => {
    if (a.running !== b.running) {
      return a.running ? -1 : 1;
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}

function isPidAlive(pid: number | null) {
  if (!pid || Number.isNaN(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function listClaudeSessions(): Promise<AgentSession[]> {
  const dir = path.join(os.homedir(), ".claude", "sessions");

  if (!existsSync(dir)) {
    return [];
  }

  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  const sessions: AgentSession[] = [];

  for (const file of files) {
    try {
      const raw = await readFile(path.join(dir, file), "utf8");
      const data = JSON.parse(raw) as {
        pid?: number;
        sessionId?: string;
        cwd?: string;
        status?: string;
        startedAt?: number;
        updatedAt?: number;
      };

      const pid =
        typeof data.pid === "number"
          ? data.pid
          : Number(path.basename(file, ".json"));

      if (!isPidAlive(pid)) {
        continue;
      }

      sessions.push({
        tool: "claude",
        id: data.sessionId ?? String(pid),
        name: null,
        pid,
        cwd: data.cwd ?? "",
        repoRoot: data.cwd ?? "",
        repoName: data.cwd ? path.basename(data.cwd) : "",
        worktreeRelative: "",
        branch: null,
        status: data.status ?? null,
        running: true,
        startedAt: data.startedAt ?? null,
        updatedAt: data.updatedAt ?? data.startedAt ?? null
      });
    } catch {
      // Skip malformed session files.
    }
  }

  return sessions;
}

async function listCodexSessions(): Promise<AgentSession[]> {
  const base = path.join(os.homedir(), ".codex", "sessions");

  if (!existsSync(base)) {
    return [];
  }

  const files = await collectRecentRolloutFiles(base);
  const threadNames = await loadCodexThreadNames();
  const now = Date.now();
  const sessions: AgentSession[] = [];

  for (const file of files) {
    try {
      const firstLine = await readFirstLine(file);
      const meta = JSON.parse(firstLine) as {
        type?: string;
        payload?: { id?: string; cwd?: string; timestamp?: string };
      };

      if (meta.type !== "session_meta" || !meta.payload?.id) {
        continue;
      }

      const stats = await stat(file);
      const updatedAt = stats.mtimeMs;
      const startedAt = meta.payload.timestamp
        ? Date.parse(meta.payload.timestamp) || null
        : null;

      sessions.push({
        tool: "codex",
        id: meta.payload.id,
        name: threadNames.get(meta.payload.id) ?? null,
        pid: null,
        cwd: meta.payload.cwd ?? "",
        repoRoot: meta.payload.cwd ?? "",
        repoName: meta.payload.cwd ? path.basename(meta.payload.cwd) : "",
        worktreeRelative: "",
        branch: null,
        status: null,
        running: now - updatedAt < CODEX_RUNNING_THRESHOLD_MS,
        startedAt,
        updatedAt
      });
    } catch {
      // Skip unreadable rollout files.
    }
  }

  return sessions
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, CODEX_SESSION_LIMIT);
}

async function collectRecentRolloutFiles(base: string) {
  const files: string[] = [];
  const now = Date.now();

  for (let dayOffset = 0; dayOffset < CODEX_RECENT_DAYS; dayOffset += 1) {
    const date = new Date(now - dayOffset * 86_400_000);
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const dayDir = path.join(base, year, month, day);

    if (!existsSync(dayDir)) {
      continue;
    }

    try {
      const entries = await readdir(dayDir);
      for (const entry of entries) {
        if (entry.startsWith("rollout-") && entry.endsWith(".jsonl")) {
          files.push(path.join(dayDir, entry));
        }
      }
    } catch {
      // Ignore unreadable day directories.
    }
  }

  return files;
}

async function loadCodexThreadNames() {
  const indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
  const names = new Map<string, string>();

  if (!existsSync(indexPath)) {
    return names;
  }

  try {
    const raw = await readFile(indexPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const entry = JSON.parse(trimmed) as { id?: string; thread_name?: string };
      if (entry.id && entry.thread_name) {
        names.set(entry.id, entry.thread_name);
      }
    }
  } catch {
    // Ignore malformed index.
  }

  return names;
}

async function readFirstLine(file: string) {
  const handle = await open(file, "r");

  try {
    const buffer = Buffer.alloc(65_536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const newline = text.indexOf("\n");
    return newline === -1 ? text : text.slice(0, newline);
  } finally {
    await handle.close();
  }
}

async function getRepoContext(cwd: string) {
  const fallback = {
    repoRoot: cwd,
    repoName: cwd ? path.basename(cwd) : "",
    worktreeRelative: "",
    branch: null as string | null
  };

  if (!cwd || !existsSync(cwd)) {
    return fallback;
  }

  try {
    const [topLevel, commonDir] = await Promise.all([
      gitOutput(cwd, ["rev-parse", "--show-toplevel"]),
      gitOutput(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    ]);

    const worktreeRoot = topLevel.trim();
    const trimmedCommonDir = commonDir.trim();
    const repoRoot = trimmedCommonDir.endsWith("/.git")
      ? path.dirname(trimmedCommonDir)
      : worktreeRoot;
    const worktreeRelative =
      worktreeRoot === repoRoot ? "" : path.relative(repoRoot, worktreeRoot);

    // `branch --show-current` also works on an unborn HEAD (no commits yet),
    // and must not break repo/worktree resolution if it fails.
    let branch: string | null = null;
    try {
      branch = (await gitOutput(cwd, ["branch", "--show-current"])).trim() || null;
    } catch {
      branch = null;
    }

    return {
      repoRoot,
      repoName: path.basename(repoRoot),
      worktreeRelative,
      branch
    };
  } catch {
    return fallback;
  }
}

async function gitOutput(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}
