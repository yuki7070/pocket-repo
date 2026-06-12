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
  convertPresentationToPdf,
  isOfficeAvailable,
  isPresentationPath,
  OfficeUnavailableError
} from "@/lib/office";

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
    const entries = await listDirectory(effectivePath, relativePath);

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
  return c.json({ office: await isOfficeAvailable() });
});

// Preview a presentation (.pptx/.ppt/.odp) by converting it to PDF with
// LibreOffice and serving the PDF inline. The conversion result is cached and
// the original file is never modified (read-only is preserved). Requires
// LibreOffice to be installed; otherwise responds 503.
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

    if (!isPresentationPath(relativePath)) {
      throw new Error("Unsupported file type for slide preview.");
    }

    const effectivePath = await resolveWorktreePath(
      repository,
      c.req.query("worktree")
    );
    const absolutePath = resolveRepositoryPath(effectivePath, relativePath);
    const pdfPath = await convertPresentationToPdf(absolutePath);
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
              "LibreOffice is required to preview presentations. Install it (e.g. `sudo apt install libreoffice-impress`)."
          }
        },
        503
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to render presentation.";

    return c.json(
      {
        error: {
          code: message.includes("outside")
            ? "PATH_OUTSIDE_REPOSITORY"
            : "PRESENTATION_RENDER_FAILED",
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
