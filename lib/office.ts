import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getPocketRepoHome } from "./config-store";

// Office documents we can preview by converting to PDF via LibreOffice. The
// same `--convert-to pdf` pipeline handles presentations and word-processor
// documents alike.
const PRESENTATION_EXTENSIONS = new Set([".pptx", ".ppt", ".ppsx", ".odp"]);
const DOCUMENT_EXTENSIONS = new Set([".docx", ".doc", ".odt", ".rtf"]);
const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xls", ".ods"]);
const CONVERTIBLE_EXTENSIONS = new Set([
  ...PRESENTATION_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...SPREADSHEET_EXTENSIONS
]);

// Refuse to convert absurdly large inputs.
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 60_000;

export function isPresentationPath(filePath: string) {
  return PRESENTATION_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// Office documents (presentations + word-processor files) that require a
// LibreOffice conversion to PDF before they can be previewed.
export function isConvertibleDocumentPath(filePath: string) {
  return CONVERTIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// PDFs are already in the preview format, so they are served inline without
// any conversion (and without needing LibreOffice installed).
export function isPdfPath(filePath: string) {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

// Anything we can show in the PDF preview frame: native PDFs plus the office
// document types we convert to PDF.
export function isPreviewableDocumentPath(filePath: string) {
  return isPdfPath(filePath) || isConvertibleDocumentPath(filePath);
}

export class OfficeUnavailableError extends Error {
  constructor() {
    super("LibreOffice is not installed.");
    this.name = "OfficeUnavailableError";
  }
}

async function exists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(target: string) {
  try {
    await access(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Locate the LibreOffice CLI across PATH and common per-OS install locations.
// Cached after the first successful (or failed) lookup.
let cachedTool: string | null | undefined;

async function findTool() {
  if (cachedTool !== undefined) {
    return cachedTool;
  }

  const names =
    process.platform === "win32"
      ? ["soffice.exe", "soffice.com"]
      : ["soffice", "libreoffice"];
  const candidates: string[] = [];

  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      candidates.push(path.join(dir, name));
    }
  }

  if (process.platform === "darwin") {
    candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  } else if (process.platform === "linux") {
    candidates.push("/usr/bin/soffice", "/usr/bin/libreoffice", "/snap/bin/libreoffice");
  } else if (process.platform === "win32") {
    candidates.push(
      "C:/Program Files/LibreOffice/program/soffice.exe",
      "C:/Program Files (x86)/LibreOffice/program/soffice.exe"
    );
  }

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      cachedTool = candidate;
      return candidate;
    }
  }

  cachedTool = null;
  return null;
}

export async function getOfficeTool() {
  return findTool();
}

export async function isOfficeAvailable() {
  return (await findTool()) !== null;
}

// LibreOffice is effectively single-instance per user profile, so conversions
// are serialized. Each conversion also gets a throwaway profile dir.
let conversionQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = conversionQueue.then(task, task);
  conversionQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function runSoffice(
  tool: string,
  input: string,
  outDir: string,
  profileDir: string
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      tool,
      [
        "--headless",
        "--norestore",
        "--nolockcheck",
        `-env:UserInstallation=file://${profileDir}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        input
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LibreOffice conversion timed out."));
    }, CONVERT_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `LibreOffice exited with code ${code}`));
      }
    });
  });
}

function cacheDir() {
  return path.join(getPocketRepoHome(), "cache", "office");
}

// Convert an office document (presentation or word-processor file) to PDF and
// return the cached PDF path. The result is cached under ~/.pocket-repo/cache
// keyed by (path, size, mtime); the original file is never modified and the PDF
// is written outside any repository.
export async function convertOfficeToPdf(absoluteInputPath: string) {
  const tool = await findTool();
  if (!tool) {
    throw new OfficeUnavailableError();
  }

  const stats = await lstat(absoluteInputPath);
  if (!stats.isFile()) {
    throw new Error("Path is not a file.");
  }
  if (stats.size > MAX_INPUT_BYTES) {
    throw new Error("File is too large to convert.");
  }

  const key = createHash("sha256")
    .update(`${absoluteInputPath}:${stats.size}:${stats.mtimeMs}`)
    .digest("hex");
  const outputPath = path.join(cacheDir(), `${key}.pdf`);

  if (await exists(outputPath)) {
    return outputPath;
  }

  return serialize(async () => {
    if (await exists(outputPath)) {
      return outputPath;
    }

    await mkdir(cacheDir(), { recursive: true });
    const workDir = await mkdtemp(path.join(os.tmpdir(), "pocket-office-"));
    const profileDir = await mkdtemp(path.join(os.tmpdir(), "pocket-loprofile-"));

    try {
      await runSoffice(tool, absoluteInputPath, workDir, profileDir);

      const baseName = path.basename(
        absoluteInputPath,
        path.extname(absoluteInputPath)
      );
      const producedPdf = path.join(workDir, `${baseName}.pdf`);

      if (!(await exists(producedPdf))) {
        // LibreOffice can exit 0 yet emit nothing when the component that
        // handles this file type is not installed (e.g. Writer is missing, so
        // .docx/.odt cannot be opened even though Impress handles .pptx).
        throw new Error(
          "LibreOffice could not convert this document. The component for this " +
            "file type may be missing — install the full suite " +
            "(e.g. `sudo apt install libreoffice`)."
        );
      }

      // Move into the cache atomically so concurrent reads never see a partial
      // file.
      const tempCachePath = `${outputPath}.${process.pid}.tmp`;
      await copyFile(producedPdf, tempCachePath);
      await rename(tempCachePath, outputPath);

      return outputPath;
    } finally {
      await rm(workDir, { recursive: true, force: true });
      await rm(profileDir, { recursive: true, force: true });
    }
  });
}
