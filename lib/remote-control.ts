import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants, openSync } from "node:fs";
import { access, mkdir, open, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getPocketRepoHome } from "./config-store";

const execFileAsync = promisify(execFile);

// Launching a `claude remote-control` server is the one place Pocket Repo
// starts a process that can WRITE — the viewer itself stays read-only, this is
// an explicit, separate "launch an agent server" action.

export const SPAWN_MODES = ["same-dir", "worktree", "session"] as const;
export const PERMISSION_MODES = [
  "auto",
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions"
] as const;

export type SpawnMode = (typeof SPAWN_MODES)[number];
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type RemoteControlServer = {
  id: string;
  pid: number;
  name: string;
  cwd: string;
  spawn: SpawnMode;
  capacity: number;
  permissionMode: PermissionMode;
  startedAt: string;
  logFile: string;
  // When started via systemd-run, the transient unit owning the server so it
  // survives Pocket Repo restarts. Null for the plain detached fallback.
  unit: string | null;
};

export class ClaudeUnavailableError extends Error {
  constructor() {
    super("The `claude` CLI is not installed or not on PATH.");
    this.name = "ClaudeUnavailableError";
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

// Locate the Claude Code CLI across PATH and common install locations.
let cachedClaude: string | null | undefined;

async function findClaude() {
  if (cachedClaude !== undefined) {
    return cachedClaude;
  }

  const candidates: string[] = [];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, "claude"));
  }
  candidates.push(
    path.join(os.homedir(), ".local/bin/claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude"
  );

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      cachedClaude = candidate;
      return candidate;
    }
  }

  cachedClaude = null;
  return null;
}

export async function isClaudeAvailable() {
  return (await findClaude()) !== null;
}

// Claude stores per-directory "workspace trust" in ~/.claude.json. A
// `remote-control` server refuses to start in an untrusted directory (it can't
// pop the interactive trust dialog), so we mark the target cwd trusted before
// launching — this is what the UI's "launch an agent server" action implies.
// CLAUDE_CONFIG_DIR relocates the file when set.
function claudeConfigPath() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), ".claude.json");
}

async function ensureWorkspaceTrusted(cwd: string) {
  const configPath = claudeConfigPath();

  let config: Record<string, unknown>;
  if (await exists(configPath)) {
    try {
      config = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
      // Don't clobber an unparseable config; let the launch surface the
      // existing "Workspace not trusted" error instead.
      return;
    }
    if (typeof config !== "object" || config === null) {
      return;
    }
  } else {
    config = {};
  }

  const projects = (config.projects ??= {}) as Record<string, Record<string, unknown>>;
  const entry = (projects[cwd] ??= {});
  if (entry.hasTrustDialogAccepted === true) {
    return;
  }

  entry.hasTrustDialogAccepted = true;
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

// Locate a binary across PATH and a few common locations.
const binCache = new Map<string, string | null>();

async function findBin(name: string, extra: string[] = []) {
  if (binCache.has(name)) {
    return binCache.get(name) ?? null;
  }

  const candidates: string[] = [];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, name));
  }
  candidates.push(`/usr/bin/${name}`, `/bin/${name}`, ...extra);

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      binCache.set(name, candidate);
      return candidate;
    }
  }

  binCache.set(name, null);
  return null;
}

// Whether we can launch the server as a transient systemd --user unit, so it
// runs in its own cgroup and survives Pocket Repo restarts. Needs systemd-run
// plus a reachable per-user manager (XDG_RUNTIME_DIR is set for that).
async function systemdRun() {
  if (!process.env.XDG_RUNTIME_DIR) {
    return null;
  }
  const run = await findBin("systemd-run");
  const ctl = await findBin("systemctl");
  return run && ctl ? { run, ctl } : null;
}

// MainPID can be momentarily 0 right after the unit starts; retry briefly.
async function queryMainPid(ctl: string, unit: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(ctl, [
        "--user",
        "show",
        "-p",
        "MainPID",
        "--value",
        unit
      ]);
      const pid = Number(stdout.trim()) || 0;
      if (pid > 0) {
        return pid;
      }
    } catch {
      // transient; retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return 0;
}

function registryPath() {
  return path.join(getPocketRepoHome(), "remote-control.json");
}

function logsDir() {
  return path.join(getPocketRepoHome(), "logs");
}

async function readRegistry(): Promise<RemoteControlServer[]> {
  if (!(await exists(registryPath()))) {
    return [];
  }
  try {
    const parsed = JSON.parse(await readFile(registryPath(), "utf8"));
    return Array.isArray(parsed?.servers) ? parsed.servers : [];
  } catch {
    return [];
  }
}

async function writeRegistry(servers: RemoteControlServer[]) {
  await writeFile(registryPath(), JSON.stringify({ servers }, null, 2));
}

function isPidAlive(pid: number) {
  // Guard against 0/negative: process.kill(0, …) targets our own process group.
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Read only the last `limit` bytes of a log file. These logs are written by a
// long-running `claude remote-control` process that redraws its status line
// continuously, so they grow without bound (hundreds of MB). Reading the whole
// file into a string to slice the tail blows the heap — open and read just the
// tail instead. Bytes ≈ chars here (the logs are ASCII/ANSI), so a byte budget
// is a fine stand-in for the previous character budget.
async function tailLog(logFile: string, limit = 4000) {
  let handle;
  try {
    handle = await open(logFile, "r");
  } catch {
    return "";
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, Number(size) - limit);
    const length = Number(size) - start;
    if (length <= 0) {
      return "";
    }
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    await handle.close();
  }
}

// Strip the ANSI/terminal control sequences a TTY-oriented program emits, so
// the captured connection info reads cleanly in the UI.
function stripAnsi(value: string) {
  return (
    value
      // CSI escape sequences (colours, cursor moves, ...)
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // OSC sequences terminated by BEL or ESC backslash
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
      // carriage returns used for in-place redraws
      .replace(/\r/g, "")
  );
}

// Pull the claude.ai/code link out of a server's log so the UI can offer a
// tap-to-open shortcut. The environment URL is plain text (survives stripAnsi)
// and is the canonical entry to the server; the per-session URL lives inside an
// OSC-8 hyperlink, so read it from the raw log before it's stripped.
function extractConnectUrl(rawLog: string): string | null {
  const env = rawLog.match(/https:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9]+/);
  if (env) {
    return env[0];
  }
  const session = rawLog.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/);
  return session ? `${session[0]}?from=cli` : null;
}

// The per-session claude.ai ids a server has handled, in creation order,
// filtered to those still active (appearing in the recent log tail — the status
// line redraws the live sessions continuously, so stale/ended ones drop off).
function activeSessionIds(log: string): string[] {
  const linkRe = /\/code\/(session_[A-Za-z0-9]+)\?from=cli/g;

  const order: string[] = [];
  const seen = new Set<string>();
  for (const match of log.matchAll(linkRe)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      order.push(match[1]);
    }
  }

  const tail = log.slice(-4000);
  const active = new Set(
    Array.from(tail.matchAll(linkRe), (match) => match[1])
  );
  return order.filter((id) => active.has(id));
}

// For each running server, the active session ids it owns (creation order).
// Used to map same-dir sessions — which don't record their own id — to a
// claude.ai link by position (oldest local session ↔ oldest active id).
export async function listRemoteControlSessionIds() {
  const alive = (await readRegistry()).filter((server) => isPidAlive(server.pid));
  return Promise.all(
    alive.map(async (server) => ({
      cwd: server.cwd,
      sessionIds: activeSessionIds(await tailLog(server.logFile, 1_000_000))
    }))
  );
}

export async function listRemoteControls() {
  const servers = await readRegistry();
  const alive = servers.filter((server) => isPidAlive(server.pid));

  if (alive.length !== servers.length) {
    await writeRegistry(alive);
  }

  return Promise.all(
    alive.map(async (server) => {
      const rawLog = await tailLog(server.logFile);
      return {
        ...server,
        log: stripAnsi(rawLog),
        url: extractConnectUrl(rawLog)
      };
    })
  );
}

export async function startRemoteControl(options: {
  cwd: string;
  name: string;
  spawn: SpawnMode;
  capacity: number;
  permissionMode: PermissionMode;
}) {
  const claude = await findClaude();
  if (!claude) {
    throw new ClaudeUnavailableError();
  }

  if (!SPAWN_MODES.includes(options.spawn)) {
    throw new Error("Invalid spawn mode.");
  }
  if (!PERMISSION_MODES.includes(options.permissionMode)) {
    throw new Error("Invalid permission mode.");
  }

  await ensureWorkspaceTrusted(options.cwd);

  const id = `rc_${randomUUID()}`;
  await mkdir(logsDir(), { recursive: true });
  const logFile = path.join(logsDir(), `${id}.log`);

  const claudeArgs = [
    "remote-control",
    "--name",
    options.name,
    "--spawn",
    options.spawn,
    "--permission-mode",
    options.permissionMode
  ];

  // session mode is fixed at capacity 1; passing --capacity is rejected
  // ("--capacity cannot be used with --spawn=session"), so only send it for
  // the multi-session modes.
  if (options.spawn !== "session") {
    claudeArgs.push("--capacity", String(options.capacity));
  }

  const systemd = await systemdRun();
  let pid: number;
  let unit: string | null = null;

  if (systemd) {
    // Launch as a transient systemd --user unit. The per-user manager (not this
    // process) forks it into its own cgroup, so it outlives Pocket Repo.
    unit = `pocket-repo-${id}.service`;
    await execFileAsync(systemd.run, [
      "--user",
      "--collect",
      `--unit=${unit}`,
      `--description=Pocket Repo remote-control: ${options.name}`,
      "-p",
      `WorkingDirectory=${options.cwd}`,
      "-p",
      `StandardOutput=append:${logFile}`,
      "-p",
      `StandardError=append:${logFile}`,
      "--",
      claude,
      ...claudeArgs
    ]);

    pid = await queryMainPid(systemd.ctl, unit);
  } else {
    // Fallback: plain detached process. Survives a parent kill, but not a
    // systemd cgroup stop — fine for non-systemd runs (npx, containers, macOS).
    const fd = openSync(logFile, "a");
    try {
      const child = spawn(claude, claudeArgs, {
        cwd: options.cwd,
        detached: true,
        stdio: ["ignore", fd, fd]
      });
      child.unref();
      if (!child.pid) {
        throw new Error("Failed to start the remote-control server.");
      }
      pid = child.pid;
    } finally {
      closeSync(fd);
    }
  }

  const entry: RemoteControlServer = {
    id,
    pid,
    name: options.name,
    cwd: options.cwd,
    spawn: options.spawn,
    capacity: options.capacity,
    permissionMode: options.permissionMode,
    startedAt: new Date().toISOString(),
    logFile,
    unit
  };

  const servers = await readRegistry();
  servers.unshift(entry);
  await writeRegistry(servers);

  return entry;
}

export async function stopRemoteControl(id: string) {
  const servers = await readRegistry();
  const target = servers.find((server) => server.id === id);

  if (!target) {
    return false;
  }

  if (target.unit) {
    // Stop the transient unit; KillMode=control-group tears down the server
    // and any sessions it spawned in one go.
    const ctl = await findBin("systemctl");
    if (ctl) {
      try {
        await execFileAsync(ctl, ["--user", "stop", target.unit]);
      } catch {
        // unit may already be gone
      }
    }
  } else {
    // Detached fallback: kill the process group, then the single pid.
    try {
      process.kill(-target.pid, "SIGTERM");
    } catch {
      try {
        process.kill(target.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  await writeRegistry(servers.filter((server) => server.id !== id));
  return true;
}
