# Pocket Repo

A local, **read-only** Git repository viewer built for mobile browsers. Run it
on your machine and browse your repositories — files, diffs, branches,
worktrees, and running coding-agent sessions — from your phone or any browser
on the same network.

Pocket Repo never edits files or mutates Git state. It only reads.

## Features

- **File browser** — navigate directories and open files, GitHub-style. Opening
  a file switches to a dedicated file view with a breadcrumb path.
- **Image & Markdown rendering** — images render inline, Markdown renders with
  embedded images and working relative links.
- **Status & branch diff** — see uncommitted working-tree changes, or compare
  the current branch against another branch (e.g. `develop`) to list the files
  that differ.
- **File search** — quickly find files by name across the repository.
- **Worktree switching** — switch between a repository's linked worktrees; file
  listings, diffs, and search follow the selected worktree.
- **Grouped recent repositories** — recent repositories are grouped by their
  underlying repo, with collapsible groups for their worktrees.
- **Agents dashboard** — see which Claude Code and Codex sessions are running and
  which worktree each is working in, both globally and per repository.

## Tech stack

- [Next.js 15](https://nextjs.org/) (App Router) + React 19
- [shadcn/ui](https://ui.shadcn.com/) on Tailwind CSS v4 (Base UI primitives)
- [Hono](https://hono.dev/) for the API routes
- `react-markdown` + `remark-gfm` for Markdown rendering

## Getting started

Requirements: Node.js 20+ and [pnpm](https://pnpm.io/).

```bash
pnpm install

# Development
pnpm dev

# Production
pnpm build
pnpm start
```

By default the server listens on the standard Next.js port (`3000`). To expose it
on your network — for example to open it from a phone — bind to all interfaces
and pick a port:

```bash
pnpm exec next start -H 0.0.0.0 -p 4545
```

Then open `http://<your-machine-ip>:4545` from another device on the same
network.

### Scripts

| Script           | Description                     |
| ---------------- | ------------------------------- |
| `pnpm dev`       | Start the dev server            |
| `pnpm build`     | Production build                |
| `pnpm start`     | Start the production server     |
| `pnpm lint`      | Run ESLint                      |
| `pnpm typecheck` | Type-check with `tsc --noEmit`  |

## How it works

Pocket Repo keeps a small list of recently opened repositories under
`~/.pocket-repo/`. Repository contents are read directly from disk and through
read-only `git` commands (`status`, `diff`, `branch`, `worktree list`, …). The
Agents dashboard reads Claude Code session metadata from `~/.claude/sessions`
and Codex session metadata from `~/.codex/sessions` to show which agents are
active and where.

Because everything is local and read-only, no credentials, remotes, or write
access are required.

## License

Private project. All rights reserved unless stated otherwise.
