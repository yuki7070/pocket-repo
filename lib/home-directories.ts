import { execFile } from "node:child_process";
import { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type HomeDirectoryEntry = {
  name: string;
  path: string;
  isRepository: boolean;
};

export type HomeDirectoryListing = {
  home: string;
  path: string;
  parentPath: string | null;
  isRepository: boolean;
  directories: HomeDirectoryEntry[];
};

export async function listHomeDirectories(inputPath?: string) {
  const home = os.homedir();
  const directoryPath = resolveHomePath(home, inputPath);
  const directoryStats = await stat(directoryPath);

  if (!directoryStats.isDirectory()) {
    throw new Error("Path is not a directory.");
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const visibleDirectories = entries.filter(isVisibleDirectory);
  const directories = await Promise.all(
    visibleDirectories.map(async (entry) => {
      const childPath = path.join(directoryPath, entry.name);

      return {
        name: entry.name,
        path: childPath,
        isRepository: await isGitRepository(childPath)
      } satisfies HomeDirectoryEntry;
    })
  );

  directories.sort((a, b) => {
    if (a.isRepository !== b.isRepository) {
      return a.isRepository ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  return {
    home,
    path: directoryPath,
    parentPath: directoryPath === home ? null : path.dirname(directoryPath),
    isRepository: await isGitRepository(directoryPath),
    directories
  } satisfies HomeDirectoryListing;
}

function resolveHomePath(home: string, inputPath?: string) {
  if (!inputPath) {
    return home;
  }

  const resolvedPath = path.resolve(inputPath);
  const relativeFromHome = path.relative(home, resolvedPath);

  if (relativeFromHome.startsWith("..") || path.isAbsolute(relativeFromHome)) {
    throw new Error("Path is outside home directory.");
  }

  return resolvedPath;
}

function isVisibleDirectory(entry: Dirent) {
  if (!entry.isDirectory()) {
    return false;
  }

  if (entry.name.startsWith(".")) {
    return false;
  }

  return true;
}

async function isGitRepository(directoryPath: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: directoryPath,
        timeout: 1200
      }
    );

    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
