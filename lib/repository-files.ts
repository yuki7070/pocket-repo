import { spawn } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const TEXT_FILE_LIMIT = 1024 * 1024;
const RAW_FILE_LIMIT = 25 * 1024 * 1024;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp"
};

export function imageContentType(filePath: string) {
  return IMAGE_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

// Content types for files served by the HTML render endpoint: the document
// itself plus the sibling assets it commonly references (styles, scripts,
// fonts). Anything unknown falls back to a generic binary type.
const RENDER_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject"
};

export function renderContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    RENDER_CONTENT_TYPES[extension] ?? IMAGE_CONTENT_TYPES[extension] ?? null
  );
}

export function isHtmlPath(filePath: string) {
  return /\.html?$/i.test(filePath);
}

// Serve a file's raw bytes for the HTML render endpoint. Used both for the
// HTML document and for the relative assets (css/js/images/fonts) it loads.
export async function readRepositoryRaw(
  repositoryPath: string,
  relativePath: string
) {
  const absolutePath = resolveRepositoryPath(repositoryPath, relativePath);
  const contentType =
    renderContentType(relativePath) ?? "application/octet-stream";

  const stats = await lstat(absolutePath);

  if (!stats.isFile()) {
    throw new Error("Path is not a file.");
  }

  if (stats.size > RAW_FILE_LIMIT) {
    throw new Error("File is too large to display.");
  }

  const buffer = await readFile(absolutePath);

  return { buffer, contentType, size: stats.size };
}

export async function readRepositoryImage(
  repositoryPath: string,
  relativePath: string
) {
  const absolutePath = resolveRepositoryPath(repositoryPath, relativePath);
  const contentType = imageContentType(relativePath);

  if (!contentType) {
    throw new Error("Unsupported file type for raw access.");
  }

  const stats = await lstat(absolutePath);

  if (!stats.isFile()) {
    throw new Error("Path is not a file.");
  }

  if (stats.size > RAW_FILE_LIMIT) {
    throw new Error("File is too large to display.");
  }

  const buffer = await readFile(absolutePath);

  return { buffer, contentType, size: stats.size };
}

// Total uncompressed size allowed for a folder download. Folders are zipped in
// memory, so this bounds how much we buffer at once.
const DOWNLOAD_ZIP_LIMIT = 200 * 1024 * 1024;

export type DownloadFile = {
  buffer: Buffer;
  fileName: string;
};

// Read a single file's raw bytes for download. Unlike readRepositoryImage this
// places no restriction on the file type — any file in the repo can be saved.
export async function readFileForDownload(
  repositoryPath: string,
  relativePath: string
): Promise<DownloadFile> {
  const absolutePath = resolveRepositoryPath(repositoryPath, relativePath);
  const stats = await lstat(absolutePath);

  if (!stats.isFile()) {
    throw new Error("Path is not a file.");
  }

  if (stats.size > DOWNLOAD_ZIP_LIMIT) {
    throw new Error("File is too large to download.");
  }

  const buffer = await readFile(absolutePath);

  return { buffer, fileName: path.basename(absolutePath) };
}

// Read the given repo-relative files into ZIP entries rooted under `baseName`,
// so the archive extracts into a single folder (e.g. `src/` for a `src`
// download). Files that vanished between listing and reading are skipped, and
// the running total is capped to bound memory use.
export async function readFilesForZip(
  repositoryPath: string,
  filePaths: string[],
  baseName: string,
  basePrefix: string
) {
  const prefix = basePrefix.replace(/^\/+|\/+$/g, "");
  const entries: { name: string; data: Buffer }[] = [];
  let total = 0;

  for (const filePath of filePaths) {
    const absolutePath = resolveRepositoryPath(repositoryPath, filePath);

    let buffer: Buffer;
    try {
      const stats = await lstat(absolutePath);
      if (!stats.isFile()) {
        continue;
      }
      total += stats.size;
      if (total > DOWNLOAD_ZIP_LIMIT) {
        throw new Error("Folder is too large to download.");
      }
      buffer = await readFile(absolutePath);
    } catch (error) {
      if (error instanceof Error && error.message.includes("too large")) {
        throw error;
      }
      // Tracked-but-deleted or unreadable files are simply omitted.
      continue;
    }

    const relativeToBase = prefix
      ? filePath.slice(prefix.length).replace(/^\/+/, "")
      : filePath;
    entries.push({
      name: `${baseName}/${relativeToBase}`,
      data: buffer
    });
  }

  return entries;
}

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
  lastModifiedAt: string;
  /** True when the entry is gitignored. Only surfaced when includeIgnored is set. */
  ignored: boolean;
};

export type FileContent = {
  path: string;
  name: string;
  language: string;
  size: number;
  content: string | null;
  binary: boolean;
  tooLarge: boolean;
  isMarp: boolean;
};

export async function listDirectory(
  repositoryPath: string,
  relativePath: string,
  options: { includeIgnored?: boolean } = {}
) {
  const absolutePath = resolveRepositoryPath(repositoryPath, relativePath);
  const stats = await lstat(absolutePath);

  if (!stats.isDirectory()) {
    throw new Error("Path is not a directory.");
  }

  // The `.git` directory is always hidden, even when including ignored entries:
  // it is huge, noisy, and meaningless in a read-only viewer.
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const candidateEntries = entries.filter((entry) => entry.name !== ".git");
  const ignoredPaths = await listIgnoredPaths(
    repositoryPath,
    candidateEntries.map((entry) =>
      normalizeRelativePath(path.posix.join(toPosixPath(relativePath), entry.name))
    )
  );
  const visibleEntries = options.includeIgnored
    ? candidateEntries
    : candidateEntries.filter((entry) => {
        const entryRelativePath = normalizeRelativePath(
          path.posix.join(toPosixPath(relativePath), entry.name)
        );

        return !ignoredPaths.has(entryRelativePath);
      });
  const fileEntries = await Promise.all(
    visibleEntries
      .map(async (entry) => {
        const entryRelativePath = normalizeRelativePath(
          path.posix.join(toPosixPath(relativePath), entry.name)
        );
        const entryAbsolutePath = path.join(absolutePath, entry.name);
        const entryStats = await lstat(entryAbsolutePath);

        return {
          name: entry.name,
          path: entryRelativePath,
          type: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? null : entryStats.size,
          lastModifiedAt: entryStats.mtime.toISOString(),
          ignored: ignoredPaths.has(entryRelativePath)
        } satisfies FileEntry;
      })
  );

  return fileEntries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

export async function readRepositoryFile(
  repositoryPath: string,
  relativePath: string
) {
  const absolutePath = resolveRepositoryPath(repositoryPath, relativePath);
  const stats = await lstat(absolutePath);

  if (!stats.isFile()) {
    throw new Error("Path is not a file.");
  }

  const filePath = normalizeRelativePath(relativePath);
  const result: FileContent = {
    path: filePath,
    name: path.basename(filePath),
    language: detectLanguage(filePath),
    size: stats.size,
    content: null,
    binary: false,
    tooLarge: stats.size > TEXT_FILE_LIMIT,
    isMarp: false
  };

  if (result.tooLarge) {
    return result;
  }

  const buffer = await readFile(absolutePath);

  if (isBinary(buffer)) {
    return {
      ...result,
      binary: true
    };
  }

  const content = buffer.toString("utf8");

  return {
    ...result,
    content,
    isMarp: result.language === "markdown" && hasMarpFrontmatter(content)
  };
}

// A Marp deck is Markdown with `marp: true` in its leading YAML frontmatter.
function hasMarpFrontmatter(content: string) {
  const match = content.match(/^﻿?\s*---\r?\n([\s\S]*?)\r?\n---/);
  return match ? /^\s*marp\s*:\s*true\s*$/m.test(match[1]) : false;
}

export function resolveRepositoryPath(
  repositoryPath: string,
  relativePath: string
) {
  const normalizedRepositoryPath = path.resolve(repositoryPath);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(
    normalizedRepositoryPath,
    normalizedRelativePath
  );
  const relativeFromRoot = path.relative(normalizedRepositoryPath, absolutePath);

  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot)
  ) {
    throw new Error("Path is outside repository.");
  }

  return absolutePath;
}

function normalizeRelativePath(relativePath: string) {
  const withoutBackslashes = relativePath.replaceAll("\\", "/");
  const normalized = path.posix.normalize(withoutBackslashes);

  if (normalized === "." || normalized === "/") {
    return "";
  }

  return normalized.replace(/^\/+/, "");
}

function toPosixPath(relativePath: string) {
  return normalizeRelativePath(relativePath);
}

function isBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));

  return sample.includes(0);
}

function detectLanguage(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();

  if (name === "dockerfile") {
    return "dockerfile";
  }

  const languages: Record<string, string> = {
    ".css": "css",
    ".html": "html",
    ".js": "javascript",
    ".json": "json",
    ".jsx": "javascript",
    ".md": "markdown",
    ".mdx": "markdown",
    ".mjs": "javascript",
    ".py": "python",
    ".sh": "shell",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".yaml": "yaml",
    ".yml": "yaml"
  };

  return languages[extension] ?? "text";
}

async function listIgnoredPaths(repositoryPath: string, relativePaths: string[]) {
  if (relativePaths.length === 0) {
    return new Set<string>();
  }

  return new Promise<Set<string>>((resolve) => {
    const child = spawn("git", ["check-ignore", "-z", "--stdin"], {
      cwd: repositoryPath,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    // A non-Git directory has nothing to ignore; don't fail the listing.
    child.on("error", () => resolve(new Set<string>()));
    child.on("close", (code) => {
      // 0 = some paths ignored, 1 = none ignored. Anything else (e.g. 128 for a
      // non-Git directory) means we simply can't filter — show everything.
      if (code !== 0 && code !== 1) {
        resolve(new Set<string>());
        return;
      }

      resolve(
        new Set(
          Buffer.concat(stdout)
            .toString("utf8")
            .split("\0")
            .map((value) => value.trim())
            .filter(Boolean)
        )
      );
    });

    child.stdin.end(relativePaths.join("\0"));
  });
}
