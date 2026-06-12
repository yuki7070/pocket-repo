import path from "node:path";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  ensurePocketRepoHome,
  getRecentRepository,
  getPocketRepoHome,
  listRecentRepositories,
  openRepository,
  removeRecentRepository,
  touchRepository
} from "@/lib/config-store";
import {
  getDiffEntries,
  getRepositorySummary,
  getStatusEntries,
  getWorktreeContext,
  listBranches,
  listWorktrees,
  searchFileNames
} from "@/lib/git";
import type { RecentRepository } from "@/lib/config-store";
import { listAgentSessions } from "@/lib/agents";
import { listHomeDirectories } from "@/lib/home-directories";
import {
  isHtmlPath,
  listDirectory,
  readRepositoryFile,
  readRepositoryImage,
  readRepositoryRaw,
  resolveRepositoryPath
} from "@/lib/repository-files";
import { renderMarpDeck } from "@/lib/marp";
import {
  convertOfficeToPdf,
  isOfficeAvailable,
  isPdfPath,
  isPreviewableDocumentPath,
  OfficeUnavailableError
} from "@/lib/office";
import {
  ClaudeUnavailableError,
  isClaudeAvailable,
  listRemoteControls,
  startRemoteControl,
  stopRemoteControl,
  PERMISSION_MODES,
  SPAWN_MODES,
  type PermissionMode,
  type SpawnMode
} from "@/lib/remote-control";

export const runtime = "nodejs";

const app = new Hono().basePath("/api");

// Attach the main repository + worktree context so the client can group
// recent entries (e.g. a repo and its linked worktrees) together.
async function withWorktreeContext(repository: RecentRepository) {
  const context = await getWorktreeContext(repository.path);
  return { ...repository, ...context };
}

// Resolve the working-tree directory to read from. When a `worktree` query is
// supplied it must match one of the repository's own worktrees, so an arbitrary
// filesystem path can never be reached through this parameter.
async function resolveWorktreePath(
  repository: { path: string },
  worktreeParam: string | undefined | null
) {
  if (!worktreeParam) {
    return repository.path;
  }

  const target = path.resolve(worktreeParam);

  if (target === path.resolve(repository.path)) {
    return repository.path;
  }

  const worktrees = await listWorktrees(repository.path);
  const match = worktrees.find((wt) => path.resolve(wt.path) === target);

  if (!match) {
    throw new Error("Worktree does not belong to this repository.");
  }

  return match.path;
}

app.get("/health", async (c) => {
  const configHome = await ensurePocketRepoHome();

  return c.json({
    status: "ok",
    app: "pocket-repo",
    configHome,
    readOnly: true
  });
});

app.get("/settings", async (c) => {
  const configHome = await ensurePocketRepoHome();

  return c.json({
    configHome,
    defaults: {
      host: "127.0.0.1",
      port: 4545,
      theme: "system"
    }
  });
});

app.get("/repositories", async (c) => {
  const repositories = await listRecentRepositories();
  const enriched = await Promise.all(repositories.map(withWorktreeContext));

  return c.json({
    repositories: enriched
  });
});

app.get("/agents", async (c) => {
  try {
    const sessions = await listAgentSessions();

    return c.json({
      sessions
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load agent sessions.";

    return c.json(
      {
        error: {
          code: "AGENT_SESSIONS_FAILED",
          message
        }
      },
      500
    );
  }
});

app.get("/directories", async (c) => {
  try {
    const listing = await listHomeDirectories(c.req.query("path"));

    return c.json(listing);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list directories.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_HOME"
            : "DIRECTORY_LIST_FAILED",
          message
        }
      },
      400
    );
  }
});

app.post("/repositories/open", async (c) => {
  try {
    const body = (await c.req.json()) as { path?: unknown };

    if (typeof body.path !== "string") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Repository path must be a string."
          }
        },
        400
      );
    }

    const repository = await openRepository(body.path);

    return c.json({
      repository: await withWorktreeContext(repository)
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open repository.";

    return c.json(
      {
        error: {
          code: "OPEN_REPOSITORY_FAILED",
          message
        }
      },
      400
    );
  }
});

app.post("/repositories/:repositoryId/touch", async (c) => {
  const updated = await touchRepository(c.req.param("repositoryId"));

  if (!updated) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  return c.json({ ok: true });
});

// Forget a repository from the recent list (does not touch the project on disk).
app.delete("/repositories/:repositoryId", async (c) => {
  const removed = await removeRecentRepository(c.req.param("repositoryId"));

  if (!removed) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  return c.json({ ok: true });
});

app.get("/repositories/:repositoryId", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const summary = await getRepositorySummary(effectivePath);

    return c.json({
      repository,
      summary
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load repository summary.";

    return c.json(
      {
        error: {
          code: "GIT_COMMAND_FAILED",
          message
        }
      },
      500
    );
  }
});

app.get("/repositories/:repositoryId/worktrees", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const worktrees = await listWorktrees(repository.path);

    return c.json({
      worktrees
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load worktrees.";

    return c.json(
      {
        error: {
          code: "GIT_COMMAND_FAILED",
          message
        }
      },
      500
    );
  }
});

app.get("/repositories/:repositoryId/status", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const entries = await getStatusEntries(effectivePath);

    return c.json({
      entries
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load status.";

    return c.json(
      {
        error: {
          code: "GIT_COMMAND_FAILED",
          message
        }
      },
      500
    );
  }
});

app.get("/repositories/:repositoryId/branches", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const branches = await listBranches(effectivePath);

    return c.json({
      branches
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load branches.";

    return c.json(
      {
        error: {
          code: "GIT_COMMAND_FAILED",
          message
        }
      },
      500
    );
  }
});

app.get("/repositories/:repositoryId/diff", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  const base = c.req.query("base");

  if (!base) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "A base branch is required."
        }
      },
      400
    );
  }

  try {
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const entries = await getDiffEntries(effectivePath, base);

    return c.json({
      base,
      entries
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load diff.";

    return c.json(
      {
        error: {
          code: "GIT_COMMAND_FAILED",
          message
        }
      },
      500
    );
  }
});

app.get("/repositories/:repositoryId/search", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const query = c.req.query("q") ?? "";
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const results = await searchFileNames(effectivePath, query);

    return c.json({
      query,
      results
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to search files.";

    return c.json(
      {
        error: {
          code: "GIT_COMMAND_FAILED",
          message
        }
      },
      500
    );
  }
});

app.get("/repositories/:repositoryId/files", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const relativePath = c.req.query("path") ?? "";
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const includeIgnored = c.req.query("hidden") === "1";
    const entries = await listDirectory(effectivePath, relativePath, {
      includeIgnored
    });

    return c.json({
      path: relativePath,
      entries
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list directory.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_REPOSITORY"
            : "FILE_NOT_FOUND",
          message
        }
      },
      400
    );
  }
});

app.get("/repositories/:repositoryId/raw", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const relativePath = c.req.query("path") ?? "";
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const { buffer, contentType } = await readRepositoryImage(
      effectivePath,
      relativePath
    );
    const body = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

    return c.body(body, 200, {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read file.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_REPOSITORY"
            : "FILE_NOT_FOUND",
          message
        }
      },
      400
    );
  }
});

// Render an HTML file (and its sibling assets) in the browser. Uses a
// path-style route so relative URLs inside the HTML (./style.css, img/foo.png)
// resolve naturally to /render/<id>/<dir>/<asset>. The HTML document is served
// with a sandbox CSP so it runs in an opaque origin: scripts execute but the
// page cannot reach Pocket Repo's same-origin API, cookies, or storage.
app.get("/render/:repositoryId/:filePath{.+}", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const relativePath = c.req.param("filePath");
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const { buffer, contentType } = await readRepositoryRaw(
      effectivePath,
      relativePath
    );
    const body = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    };

    if (isHtmlPath(relativePath)) {
      headers["Content-Security-Policy"] =
        "sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads";
    }

    return c.body(body, 200, headers);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read file.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_REPOSITORY"
            : "FILE_NOT_FOUND",
          message
        }
      },
      400
    );
  }
});

// Render a Marp Markdown deck to slides. Reads the Markdown, renders it to a
// self-contained HTML document, and serves it with the same sandbox CSP as the
// HTML render endpoint so it can be shown in an iframe or a new tab.
app.get("/render-marp/:repositoryId/:filePath{.+}", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const relativePath = c.req.param("filePath");
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const file = await readRepositoryFile(effectivePath, relativePath);

    if (file.tooLarge || file.binary || file.content == null) {
      throw new Error("File cannot be rendered as slides.");
    }

    const deck = renderMarpDeck(file.content, file.name);

    return c.body(deck, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads"
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to render slides.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_REPOSITORY"
            : "FILE_NOT_FOUND",
          message
        }
      },
      400
    );
  }
});

// Report optional capabilities so the client can adapt its UI — currently
// whether LibreOffice is available for Office/presentation previews.
app.get("/capabilities", async (c) => {
  const [office, remoteControl] = await Promise.all([
    isOfficeAvailable(),
    isClaudeAvailable()
  ]);
  return c.json({ office, remoteControl });
});

// List running `claude remote-control` servers Pocket Repo has launched.
app.get("/remote-control", async (c) => {
  return c.json({ servers: await listRemoteControls() });
});

// Stop a remote-control server.
app.delete("/remote-control/:id", async (c) => {
  const stopped = await stopRemoteControl(c.req.param("id"));
  if (!stopped) {
    return c.json(
      { error: { code: "SERVER_NOT_FOUND", message: "Server not found." } },
      404
    );
  }
  return c.json({ ok: true });
});

// Launch a `claude remote-control` server in the repository (or worktree).
// This starts a process that can spawn write-capable Claude Code sessions — an
// explicit, opt-in action distinct from the read-only viewer.
app.post("/repositories/:repositoryId/remote-control", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: { code: "REPOSITORY_NOT_FOUND", message: "Repository not found." }
      },
      404
    );
  }

  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      spawn?: string;
      capacity?: number;
      permissionMode?: string;
      worktree?: string;
    };

    const spawnMode = (body.spawn ?? "same-dir") as SpawnMode;
    const permissionMode = (body.permissionMode ?? "auto") as PermissionMode;

    if (!SPAWN_MODES.includes(spawnMode)) {
      throw new Error("Invalid spawn mode.");
    }
    if (!PERMISSION_MODES.includes(permissionMode)) {
      throw new Error("Invalid permission mode.");
    }

    const capacity = Number.isFinite(body.capacity)
      ? Math.max(1, Math.min(64, Math.trunc(body.capacity as number)))
      : 4;
    const effectivePath = await resolveWorktreePath(repository, body.worktree);
    const name =
      (body.name ?? "").trim() ||
      `${repository.name}_${spawnMode}`;

    const server = await startRemoteControl({
      cwd: effectivePath,
      name,
      spawn: spawnMode,
      capacity,
      permissionMode
    });

    return c.json({ server });
  } catch (error) {
    if (error instanceof ClaudeUnavailableError) {
      return c.json(
        {
          error: {
            code: "CLAUDE_TOOL_MISSING",
            message:
              "The `claude` CLI is required. Install Claude Code and sign in first."
          }
        },
        503
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to start remote control.";
    return c.json(
      { error: { code: "REMOTE_CONTROL_FAILED", message } },
      400
    );
  }
});

// Preview an office document by serving it inline as a PDF. Native PDFs are
// streamed as-is (no LibreOffice needed); presentations (.pptx/.ppt/.odp) and
// word-processor documents (.docx/.doc/.odt/.rtf) are converted to PDF with
// LibreOffice. Conversions are cached and the original file is never modified
// (read-only is preserved). Requires LibreOffice for the convertible types;
// otherwise responds 503.
app.get("/render-office/:repositoryId/:filePath{.+}", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const relativePath = c.req.param("filePath");

    if (!isPreviewableDocumentPath(relativePath)) {
      throw new Error("Unsupported file type for document preview.");
    }

    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const absolutePath = resolveRepositoryPath(effectivePath, relativePath);
    // Native PDFs are already in the target format; only the office document
    // types go through the LibreOffice conversion.
    const pdfPath = isPdfPath(relativePath)
      ? absolutePath
      : await convertOfficeToPdf(absolutePath);
    const buffer = await readFile(pdfPath);
    const body = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

    return c.body(body, 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${path
        .basename(relativePath, path.extname(relativePath))
        .replace(/["\\\r\n]/g, "")}.pdf"`,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff"
    });
  } catch (error) {
    if (error instanceof OfficeUnavailableError) {
      return c.json(
        {
          error: {
            code: "OFFICE_TOOL_MISSING",
            message:
              "LibreOffice is required to preview Office documents. Install it (e.g. `sudo apt install libreoffice`)."
          }
        },
        503
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to render document.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_REPOSITORY"
            : "DOCUMENT_RENDER_FAILED",
          message
        }
      },
      400
    );
  }
});

app.get("/repositories/:repositoryId/file", async (c) => {
  const repository = await getRecentRepository(c.req.param("repositoryId"));

  if (!repository) {
    return c.json(
      {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: "Repository not found."
        }
      },
      404
    );
  }

  try {
    const relativePath = c.req.query("path") ?? "";
    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const file = await readRepositoryFile(effectivePath, relativePath);

    return c.json({
      file
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read file.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_REPOSITORY"
            : "FILE_NOT_FOUND",
          message
        }
      },
      400
    );
  }
});

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `No route for ${c.req.path}`,
        configHome: getPocketRepoHome()
      }
    },
    404
  );
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
