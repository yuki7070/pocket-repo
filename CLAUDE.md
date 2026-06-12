# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pocket Repo is a **local, read-only** Git repository viewer for mobile browsers. You run it on your machine and browse your repos (files, diffs, branches, worktrees) plus running coding-agent sessions from a phone. Next.js 15 (App Router) + React 19, with a Hono API for the backend.

Hard invariant: **never edit files or mutate Git state.** Everything is reads via `fs` and read-only `git` subcommands. Preserve this when adding features.

**The one documented exception** is the Agents tab's "remote control" action (`lib/remote-control.ts`), which launches a `claude remote-control` server that can spawn write-capable Claude Code sessions. The viewer itself still never writes; this is an explicit, opt-in "launch an agent server" capability, clearly separated from the read-only browsing. Do not add other write paths without the same explicit treatment.

## Commands

```bash
pnpm dev          # dev server (Next default port 3000)
pnpm build        # production build
pnpm start        # next start
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
```

There is **no test framework**. Verify changes by building (`pnpm typecheck && pnpm build`) and by running the app. The user has `playwright-cli` installed for driving a real browser to take screenshots / click through the UI when visual verification is needed.

Run on the network (e.g. to open from a phone): `pnpm exec next start -H 0.0.0.0 -p 4545`, or the published CLI `node bin/pocket-repo.mjs --port 4545`.

pnpm is pinned via `packageManager` (11.1.1). `pnpm-workspace.yaml` sets `nodeLinker: hoisted` — see Packaging below; do not remove it.

## Architecture

**Backend — one Hono app.** All API routes live in `app/api/[[...route]]/route.ts` (a single catch-all, `runtime = "nodejs"`). It delegates to server-only modules in `lib/`:

- `lib/config-store.ts` — recent repositories persisted in `~/.pocket-repo/recent-repositories.json`. Repos are referenced by `id`. `touchRepository` updates recency; `openRepository` resolves a path to its git toplevel.
- `lib/git.ts` — all `git` calls via `execFile` (no shell). Summary, status, diff (`base...HEAD` three-dot), branches, worktree list, and `getWorktreeContext` (maps any path to its main repo root + worktree position).
- `lib/repository-files.ts` — directory listing (filters `.git` and gitignored entries via `git check-ignore`), file reading (text with a 1 MB cap, binary/image detection), and `readRepositoryImage` for the raw image endpoint.
- `lib/agents.ts` — discovers running coding-agent sessions: Claude Code from `~/.claude/sessions/*.json` (liveness via `process.kill(pid, 0)`), Codex from `~/.codex/sessions/**/rollout-*.jsonl` headers. Enriches each with repo/worktree context.
- `lib/home-directories.ts` — directory browser for the "open repository" picker (constrained to the home dir).

**Worktree-aware endpoints.** `files`, `file`, `raw`, `status`, `diff`, `search`, and the summary endpoint accept `?worktree=<path>`. The path is validated against the repo's own `git worktree list` (`resolveWorktreePath`) before use, and file paths are validated against traversal (`resolveRepositoryPath`). Always go through these validators when adding a path/worktree parameter.

**Frontend — two big client components.** `app/repository-dashboard.tsx` is essentially the whole UI (sidebar, repo view, Code/Status/Search/Agents/Settings tabs, file viewer). `app/agents.tsx` holds the global Agents view, the per-repo Agents tab, and the `useAgentSessions` polling hook. `app/page.tsx`/`layout.tsx` are thin.

**URL is the state.** Selected repo, current path, open file, and active tab are encoded in query params (`repo`, `path`, `file`, `tab`) by `pushUrlState`/`updateUrlState`, and restored on load and on `popstate`. So tab switches and navigation are real browser history entries — keep new navigation flowing through these helpers.

## UI conventions

- `components/ui/*` are shadcn/ui components, but this project's shadcn registry is **Base UI** (`@base-ui/react`), **not Radix**. The APIs differ from typical shadcn examples:
  - `Dialog`/`Sheet`/`Select` are controlled with `open`/`onOpenChange` (or `value`/`onValueChange`).
  - Composition uses a `render={<Comp/>}` prop, not Radix's `asChild`.
  - `Select`'s `onValueChange` yields `string | null`; `SelectValue` accepts a function child `(value) => node`.
  - Before using a `components/ui` primitive in a new way, read its source to confirm the Base UI prop shape.
- Tailwind v4 (config-less, `@import "tailwindcss"` in `app/globals.css`); theme tokens are shadcn CSS variables, dark mode forced via `className="dark"` on `<html>`. Markdown preview styles live in `globals.css` under `.markdown-body`.
- File/markdown viewer (`FilePreview` in `repository-dashboard.tsx`): images render via the `/raw` endpoint; Markdown relative image/link paths are resolved against the file's directory and rewritten to `/raw` or to in-app navigation.

## Packaging & release

The npm package is a **CLI** (`npx pocket-repo`) that ships a Next.js **standalone** build.

- `next.config.ts` sets `output: "standalone"`. `scripts/copy-standalone-assets.mjs` copies `.next/static` into the standalone tree (run via `pnpm build:pkg` / `prepublishOnly`). `bin/pocket-repo.mjs` spawns the bundled `server.js` with `PORT`/`HOSTNAME`.
- All libraries are `devDependencies` and the published package has **zero runtime dependencies** — the standalone bundle is self-contained.
- `nodeLinker: hoisted` is mandatory: pnpm's default symlinked `node_modules` does not survive `npm pack`, which breaks `npx` with `Cannot find module 'next'`. Keep the bundle a flat real tree.
- CI publishes on `v*` tags via `.github/workflows/publish.yml` (uses the `NPM_TOKEN` secret + provenance). Release flow: `npm version patch` then `git push --follow-tags`. Always verify a packaging change with `npm pack` → extract to a clean dir → run `server.js`, since the failure mode only appears in the packed tarball.
