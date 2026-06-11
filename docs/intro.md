---
marp: true
theme: default
paginate: true
header: "Pocket Repo"
---

<!-- _paginate: false -->
<!-- _header: "" -->

# 📱 Pocket Repo

### Browse your Git repos from your phone

A local, **read-only** repository viewer for mobile browsers.

`npx pocket-repo`

---

## The problem

You're away from your desk, but you want to:

- Check what a coding agent changed in a worktree
- Read a file or a diff from your phone
- Glance at a README or a design mock

Cloud Git UIs need a push. Your **local** working tree doesn't live there.

---

## What Pocket Repo is

A tiny server you run on your own machine that serves a **mobile-friendly**,
**read-only** view of your local repositories.

> Hard invariant: it never edits files or mutates Git state.
> Everything is `fs` reads and read-only `git` subcommands.

Open it from any device on the same network.

---

## Features

- 📂 **File browser** — navigate and open files, GitHub-style
- 🖼️ **Image & Markdown** — inline rendering, README at the root
- 🌐 **HTML preview** — rendered in a sandboxed iframe
- 🎞️ **Marp slides** — *this very deck*, rendered from Markdown
- 🔀 **Status & branch diff** — working changes or compare vs. a branch
- 🔎 **File search** · 🌿 **Worktree switching**
- 🤖 **Agents dashboard** — running Claude Code / Codex sessions

---

## Quick start

```bash
npx pocket-repo
```

Starts on `0.0.0.0:4545`. Then open:

```
http://<your-machine-ip>:4545
```

Point it at a local Git repository and start browsing.

---

## Read-only by design

- No credentials, no remotes, no write access
- Reads from disk + read-only `git` (`status`, `diff`, `branch`, `worktree list`)
- HTML and slide previews run in an **opaque, sandboxed origin**

Safe to run against any repository on your machine.

---

<!-- _paginate: false -->

# Thanks! 🎉

Built with Next.js, Hono, and Marp.

[github.com/yuki7070/pocket-repo](https://github.com/yuki7070/pocket-repo)
