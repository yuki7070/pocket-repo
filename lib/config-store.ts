import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const CONFIG_DIR_NAME = ".pocket-repo";
const RECENT_REPOSITORIES_FILE = "recent-repositories.json";
const execFileAsync = promisify(execFile);

export type RecentRepository = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
  createdAt: string;
};

type RecentRepositoriesFile = {
  version: 1;
  repositories: RecentRepository[];
};

export function getPocketRepoHome() {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export async function ensurePocketRepoHome() {
  const configHome = getPocketRepoHome();
  await mkdir(configHome, { recursive: true });
  await ensureJsonFile(
    path.join(configHome, "config.json"),
    JSON.stringify(
      {
        version: 1,
        server: {
          host: "127.0.0.1",
          port: 4545
        },
        ui: {
          theme: "system",
          codeFontSize: 13,
          lineWrap: false
        }
      },
      null,
      2
    )
  );
  await ensureJsonFile(
    getRecentRepositoriesPath(),
    JSON.stringify(
      {
        version: 1,
        repositories: []
      },
      null,
      2
    )
  );

  return configHome;
}

export async function listRecentRepositories() {
  await ensurePocketRepoHome();
  const data = await readRecentRepositoriesFile();

  return data.repositories.sort((a, b) =>
    b.lastOpenedAt.localeCompare(a.lastOpenedAt)
  );
}

export async function getRecentRepository(repositoryId: string) {
  await ensurePocketRepoHome();
  const data = await readRecentRepositoriesFile();

  return (
    data.repositories.find((repository) => repository.id === repositoryId) ?? null
  );
}

export async function touchRepository(repositoryId: string) {
  await ensurePocketRepoHome();
  const data = await readRecentRepositoriesFile();
  const repository = data.repositories.find(
    (entry) => entry.id === repositoryId
  );

  if (!repository) {
    return null;
  }

  repository.lastOpenedAt = new Date().toISOString();
  await writeRecentRepositoriesFile(data);

  return repository;
}

export async function openRepository(inputPath: string) {
  await ensurePocketRepoHome();

  const repositoryPath = await resolveRepositoryRoot(inputPath);
  const now = new Date().toISOString();
  const data = await readRecentRepositoriesFile();
  const existing = data.repositories.find(
    (repository) => repository.path === repositoryPath
  );

  if (existing) {
    existing.lastOpenedAt = now;
    existing.name = path.basename(repositoryPath);
    await writeRecentRepositoriesFile(data);
    return existing;
  }

  const repository: RecentRepository = {
    id: `repo_${randomUUID()}`,
    name: path.basename(repositoryPath),
    path: repositoryPath,
    createdAt: now,
    lastOpenedAt: now
  };

  data.repositories.unshift(repository);
  await writeRecentRepositoriesFile(data);

  return repository;
}

async function resolveRepositoryRoot(inputPath: string) {
  const trimmedPath = inputPath.trim();

  if (!trimmedPath) {
    throw new Error("Repository path is required.");
  }

  const expandedPath = trimmedPath.startsWith("~/")
    ? path.join(os.homedir(), trimmedPath.slice(2))
    : trimmedPath;
  const absolutePath = path.resolve(expandedPath);
  const stats = await stat(absolutePath);

  if (!stats.isDirectory()) {
    throw new Error("Repository path must be a directory.");
  }

  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: absolutePath
  });

  return stdout.trim();
}

async function readRecentRepositoriesFile(): Promise<RecentRepositoriesFile> {
  const content = await readFile(getRecentRepositoriesPath(), "utf8");
  const parsed = JSON.parse(content) as RecentRepositoriesFile;

  return {
    version: 1,
    repositories: Array.isArray(parsed.repositories) ? parsed.repositories : []
  };
}

async function writeRecentRepositoriesFile(data: RecentRepositoriesFile) {
  await writeFile(
    getRecentRepositoriesPath(),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8"
  );
}

function getRecentRepositoriesPath() {
  return path.join(getPocketRepoHome(), RECENT_REPOSITORIES_FILE);
}

async function ensureJsonFile(filePath: string, initialContent: string) {
  if (existsSync(filePath)) {
    return;
  }

  await writeFile(filePath, `${initialContent}\n`, "utf8");
}
