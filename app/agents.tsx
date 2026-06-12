"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  GitBranch,
  Loader2,
  Radio,
  RefreshCw,
  Sparkles,
  Square
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const SPAWN_MODES = ["same-dir", "worktree", "session"];
const PERMISSION_MODES = [
  "auto",
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions"
];

type RemoteControlServer = {
  id: string;
  pid: number;
  name: string;
  cwd: string;
  spawn: string;
  capacity: number;
  permissionMode: string;
  startedAt: string;
  log?: string;
  url?: string | null;
};

export type AgentSession = {
  tool: "claude" | "codex";
  id: string;
  name: string | null;
  pid: number | null;
  cwd: string;
  repoRoot: string;
  repoName: string;
  worktreeRelative: string;
  branch: string | null;
  status: string | null;
  running: boolean;
  startedAt: number | null;
  updatedAt: number | null;
};

const REFRESH_INTERVAL_MS = 5000;

export function useAgentSessions(enabled: boolean) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/agents");
      const data = (await response.json()) as {
        sessions?: AgentSession[];
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Failed to load agent sessions.");
      }

      setSessions(data.sessions ?? []);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to load agent sessions."
      );
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }

    load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [enabled, load]);

  return { sessions, isLoading, errorMessage, refresh: load };
}

function timeAgo(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

  if (seconds < 45) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.round(seconds / 3600)}h ago`;
  }
  return `${Math.round(seconds / 86_400)}d ago`;
}

function statusLabel(session: AgentSession) {
  if (session.tool === "codex") {
    return session.running ? "active" : "recent";
  }

  if (session.status && session.status !== "None") {
    return session.status;
  }

  return session.running ? "running" : "idle";
}

function AgentSessionRow({
  session,
  onOpen
}: {
  session: AgentSession;
  onOpen: (cwd: string) => void;
}) {
  const updated = timeAgo(session.updatedAt);
  const ToolIcon = session.tool === "claude" ? Sparkles : Bot;
  const title = session.name ?? session.branch ?? session.id.slice(0, 8);

  return (
    <button
      type="button"
      onClick={() => onOpen(session.cwd)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md",
          session.tool === "claude"
            ? "bg-amber-500/15 text-amber-400"
            : "bg-teal-500/15 text-teal-400"
        )}
        title={session.tool === "claude" ? "Claude Code" : "Codex"}
      >
        <ToolIcon size={16} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {session.branch && session.branch !== title ? (
            <span className="hidden max-w-[45%] shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
              <GitBranch size={12} className="shrink-0" />
              <span className="truncate">{session.branch}</span>
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Folder size={12} className="shrink-0" />
          <span className="truncate">
            {session.worktreeRelative || "(main worktree)"}
          </span>
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full",
              session.running ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
            aria-hidden
          />
          <span className="text-xs text-muted-foreground">
            {statusLabel(session)}
          </span>
        </span>
        {updated ? (
          <span className="text-[11px] text-muted-foreground/70">{updated}</span>
        ) : null}
      </span>
    </button>
  );
}

function groupByRepo(sessions: AgentSession[]) {
  const groups = new Map<
    string,
    { repoRoot: string; repoName: string; sessions: AgentSession[] }
  >();

  for (const session of sessions) {
    const key = session.repoRoot || session.cwd;
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, {
        repoRoot: session.repoRoot || session.cwd,
        repoName: session.repoName || key,
        sessions: [session]
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const aRunning = a.sessions.some((session) => session.running);
    const bRunning = b.sessions.some((session) => session.running);
    if (aRunning !== bRunning) {
      return aRunning ? -1 : 1;
    }
    return a.repoName.localeCompare(b.repoName);
  });
}

export function AgentsView({
  onOpenWorktree
}: {
  onOpenWorktree: (cwd: string) => void;
}) {
  const { sessions, isLoading, errorMessage, refresh } = useAgentSessions(true);
  const runningCount = sessions.filter((session) => session.running).length;
  const groups = groupByRepo(sessions);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Claude Code &amp; Codex sessions across your machine
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{runningCount} running</Badge>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => refresh()}
            aria-label="Refresh"
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {isLoading && sessions.length === 0 ? (
          <Card className="py-0">
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          </Card>
        ) : errorMessage ? (
          <Card>
            <CardContent className="text-sm text-destructive">
              {errorMessage}
            </CardContent>
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              No active Claude Code or Codex sessions found.
            </CardContent>
          </Card>
        ) : (
          groups.map((group) => (
            <Card key={group.repoRoot} className="overflow-hidden py-0">
              <CardHeader className="border-b border-border bg-muted/40 py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {group.repoName}
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {group.repoRoot}
                  </span>
                </CardTitle>
              </CardHeader>
              <div className="divide-y divide-border">
                {group.sessions.map((session) => (
                  <AgentSessionRow
                    key={`${session.tool}-${session.id}`}
                    session={session}
                    onOpen={onOpenWorktree}
                  />
                ))}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// Launch + manage `claude remote-control` servers for this repository. This is
// the one write-capable action in the otherwise read-only viewer: it starts a
// server that can spawn Claude Code sessions, so it is clearly separated and
// opt-in.
function RemoteControlPanel({
  repositoryId,
  repositoryName,
  repositoryPath,
  worktreeParam
}: {
  repositoryId: string | null;
  repositoryName: string;
  repositoryPath: string | null;
  worktreeParam: string;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [servers, setServers] = useState<RemoteControlServer[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [spawnMode, setSpawnMode] = useState("same-dir");
  const [capacity, setCapacity] = useState(4);
  const [permissionMode, setPermissionMode] = useState("auto");
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultName = `${repositoryName}_${spawnMode}`;

  useEffect(() => {
    let active = true;
    fetch("/api/capabilities")
      .then((response) => response.json())
      .then((data) => active && setAvailable(Boolean(data?.remoteControl)))
      .catch(() => active && setAvailable(false));
    return () => {
      active = false;
    };
  }, []);

  const loadServers = useCallback(async () => {
    try {
      const response = await fetch("/api/remote-control");
      const data = (await response.json()) as { servers?: RemoteControlServer[] };
      setServers(data.servers ?? []);
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    loadServers();
    const timer = setInterval(loadServers, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadServers]);

  const repoServers = servers.filter(
    (server) =>
      !repositoryPath ||
      server.cwd === repositoryPath ||
      server.cwd.startsWith(`${repositoryPath}/`)
  );

  async function start() {
    if (!repositoryId) {
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/repositories/${repositoryId}/remote-control`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || defaultName,
            spawn: spawnMode,
            capacity,
            permissionMode,
            worktree: worktreeParam || undefined
          })
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Failed to start.");
      }
      setName("");
      setDialogOpen(false);
      await loadServers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to start.");
    } finally {
      setStarting(false);
    }
  }

  async function stop(id: string) {
    await fetch(`/api/remote-control/${id}`, { method: "DELETE" });
    await loadServers();
  }

  function toggleLog(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Radio size={15} className="text-muted-foreground" />
          Remote control
        </div>
        <Button
          size="sm"
          disabled={available === false || !repositoryId}
          onClick={() => {
            setError(null);
            setDialogOpen(true);
          }}
        >
          <Radio size={14} />
          New server
        </Button>
      </div>

      {available === false ? (
        <p className="text-sm text-muted-foreground">
          Requires the <span className="font-mono">claude</span> CLI (Claude
          Code) on PATH, signed in with a subscription.
        </p>
      ) : repoServers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No remote-control servers running for this repository. Use{" "}
          <span className="font-medium text-foreground">New server</span> to
          control sessions from claude.ai/code or the Claude app.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {repoServers.map((server) => {
            const isOpen = expanded.has(server.id);
            return (
              <div key={server.id} className="flex flex-col">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="size-2 shrink-0 rounded-full bg-green-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {server.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {server.spawn} · cap {server.capacity} ·{" "}
                      {server.permissionMode}
                    </div>
                  </div>
                  {server.url ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      render={
                        <a
                          href={server.url}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      <ExternalLink size={14} />
                      Open
                    </Button>
                  ) : null}
                  {server.log ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleLog(server.id)}
                    >
                      {isOpen ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      Output
                    </Button>
                  ) : null}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => stop(server.id)}
                  >
                    <Square size={14} />
                    Stop
                  </Button>
                </div>
                {isOpen && server.log ? (
                  <pre className="max-h-56 overflow-auto border-t border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {server.log.trim()}
                  </pre>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New remote-control server</DialogTitle>
            <DialogDescription>
              Launches <span className="font-mono">claude remote-control</span>{" "}
              in {repositoryName}. Sessions it spawns can edit files and run
              commands.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Spawn
                <Select
                  value={spawnMode}
                  onValueChange={(value) => value && setSpawnMode(value)}
                >
                  <SelectTrigger size="sm" aria-label="Spawn mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPAWN_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {mode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Capacity
                <Input
                  type="number"
                  min={1}
                  max={64}
                  value={capacity}
                  onChange={(event) =>
                    setCapacity(Number(event.target.value) || 1)
                  }
                  className="h-8"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Permission mode
              <Select
                value={permissionMode}
                onValueChange={(value) => value && setPermissionMode(value)}
              >
                <SelectTrigger size="sm" aria-label="Permission mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSION_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Name
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={defaultName}
                className="h-8"
              />
            </label>

            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}

            <div className="mt-1 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button disabled={starting || !repositoryId} onClick={start}>
                {starting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Radio size={14} />
                )}
                Start
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RepoAgentsTab({
  repositoryId,
  repositoryName,
  repositoryPath,
  worktreeParam,
  onOpenWorktree
}: {
  repositoryId: string | null;
  repositoryName: string;
  repositoryPath: string | null;
  worktreeParam: string;
  onOpenWorktree: (cwd: string) => void;
}) {
  const { sessions, isLoading, errorMessage } = useAgentSessions(true);
  const repoSessions = sessions.filter(
    (session) =>
      session.repoRoot === repositoryPath ||
      (repositoryPath ? session.cwd.startsWith(`${repositoryPath}/`) : false) ||
      session.cwd === repositoryPath
  );
  const runningCount = repoSessions.filter((session) => session.running).length;

  return (
    <div className="flex flex-col gap-4">
    <RemoteControlPanel
      repositoryId={repositoryId}
      repositoryName={repositoryName}
      repositoryPath={repositoryPath}
      worktreeParam={worktreeParam}
    />
    <Card className="overflow-hidden py-0">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
        <span>Sessions in this repository</span>
        <span>{runningCount > 0 ? `${runningCount} running` : ""}</span>
      </div>
      {isLoading && repoSessions.length === 0 ? (
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : errorMessage ? (
        <div className="p-6 text-center text-sm text-destructive">
          {errorMessage}
        </div>
      ) : repoSessions.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No Claude Code or Codex sessions in this repository.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {repoSessions.map((session) => (
            <AgentSessionRow
              key={`${session.tool}-${session.id}`}
              session={session}
              onOpen={onOpenWorktree}
            />
          ))}
        </div>
      )}
    </Card>
    </div>
  );
}
