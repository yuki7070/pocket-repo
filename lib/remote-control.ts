import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants, openSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getPocketRepoHome } from "./config-store";

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
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function tailLog(logFile: string, limit = 4000) {
  try {
    const content = await readFile(logFile, "utf8");
    return content.length > limit ? content.slice(content.length - limit) : content;
  } catch {
    return "";
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

export async function listRemoteControls() {
  const servers = await readRegistry();
  const alive = servers.filter((server) => isPidAlive(server.pid));

  if (alive.length !== servers.length) {
    await writeRegistry(alive);
  }

  return Promise.all(
    alive.map(async (server) => ({
      ...server,
      log: stripAnsi(await tailLog(server.logFile))
    }))
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

  const id = `rc_${randomUUID()}`;
  await mkdir(logsDir(), { recursive: true });
  const logFile = path.join(logsDir(), `${id}.log`);
  const fd = openSync(logFile, "a");

  try {
    const child = spawn(
      claude,
      [
        "remote-control",
        "--name",
        options.name,
        "--spawn",
        options.spawn,
        "--capacity",
        String(options.capacity),
        "--permission-mode",
        options.permissionMode
      ],
      { cwd: options.cwd, detached: true, stdio: ["ignore", fd, fd] }
    );
    child.unref();

    if (!child.pid) {
      throw new Error("Failed to start the remote-control server.");
    }

    const entry: RemoteControlServer = {
      id,
      pid: child.pid,
      name: options.name,
      cwd: options.cwd,
      spawn: options.spawn,
      capacity: options.capacity,
      permissionMode: options.permissionMode,
      startedAt: new Date().toISOString(),
      logFile
    };

    const servers = await readRegistry();
    servers.unshift(entry);
    await writeRegistry(servers);

    return entry;
  } finally {
    closeSync(fd);
  }
}

export async function stopRemoteControl(id: string) {
  const servers = await readRegistry();
  const target = servers.find((server) => server.id === id);

  if (!target) {
    return false;
  }

  // Detached children are their own process group; kill the group, then fall
  // back to the single pid.
  try {
    process.kill(-target.pid, "SIGTERM");
  } catch {
    try {
      process.kill(target.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }

  await writeRegistry(servers.filter((server) => server.id !== id));
  return true;
}
