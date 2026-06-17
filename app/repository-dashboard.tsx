"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  File,
  Folder,
  GitBranch,
  GitCompare,
  Loader2,
  Menu,
  MoreVertical,
  Search,
  Settings,
  Smartphone,
  Trash2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentsView, RepoAgentsTab } from "@/app/agents";

type RecentRepository = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
  createdAt: string;
  repoRoot?: string;
  repoName?: string;
  worktreeRelative?: string;
  branch?: string | null;
  isMainWorktree?: boolean;
};

type RepositorySummary = {
  isGitRepository: boolean;
  currentBranch: string | null;
  branchCount: number;
  worktreeCount: number;
  dirty: boolean;
  changedFileCount: number;
};

type WorktreeSummary = {
  path: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
  detached: boolean;
};

const SHOW_HIDDEN_STORAGE_KEY = "pocket-repo:show-hidden";

type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
  lastModifiedAt: string;
  ignored?: boolean;
};

type FileContent = {
  path: string;
  name: string;
  language: string;
  size: number;
  content: string | null;
  binary: boolean;
  tooLarge: boolean;
  isMarp: boolean;
};

type DirectoryEntry = {
  name: string;
  path: string;
  isRepository: boolean;
};

type DirectoryListing = {
  home: string;
  path: string;
  parentPath: string | null;
  isRepository: boolean;
  directories: DirectoryEntry[];
};

const tabs = [
  { label: "Code", icon: Code2 },
  { label: "Status", icon: GitCompare },
  { label: "Search", icon: Search },
  { label: "Agents", icon: Bot },
  { label: "Settings", icon: Settings }
];

export function RepositoryDashboard() {
  const [repositories, setRepositories] = useState<RecentRepository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(
    null
  );
  const [activeTab, setActiveTab] = useState("Code");
  const [view, setView] = useState<"repository" | "agents">("repository");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRepositoryPickerOpen, setIsRepositoryPickerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<RepositorySummary | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeSummary[]>([]);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [readmeFile, setReadmeFile] = useState<FileContent | null>(null);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [fileErrorMessage, setFileErrorMessage] = useState<string | null>(null);
  const [directoryListing, setDirectoryListing] =
    useState<DirectoryListing | null>(null);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(false);
  const [directoryErrorMessage, setDirectoryErrorMessage] = useState<
    string | null
  >(null);
  const [isOpening, setIsOpening] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const didApplyInitialUrl = useRef(false);

  // "Show hidden" is a sticky display preference, persisted across repositories
  // and sessions in localStorage (kept out of the URL, which encodes navigation).
  useEffect(() => {
    if (window.localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY) === "1") {
      setShowHidden(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SHOW_HIDDEN_STORAGE_KEY, showHidden ? "1" : "0");
  }, [showHidden]);

  const selectedRepository = useMemo(() => {
    return (
      repositories.find((repository) => repository.id === selectedRepositoryId) ??
      repositories[0] ??
      null
    );
  }, [repositories, selectedRepositoryId]);

  const worktreeParam =
    selectedWorktreePath && selectedWorktreePath !== selectedRepository?.path
      ? selectedWorktreePath
      : "";

  useEffect(() => {
    let mounted = true;

    async function loadRepositories() {
      try {
        const response = await fetch("/api/repositories");
        const data = (await response.json()) as {
          repositories?: RecentRepository[];
        };

        if (!mounted) {
          return;
        }

        const nextRepositories = data.repositories ?? [];
        const urlState = readUrlState();
        const urlRepository = nextRepositories.find(
          (repository) => repository.id === urlState.repositoryId
        );

        setRepositories(nextRepositories);
        setSelectedRepositoryId(
          urlRepository?.id ?? nextRepositories[0]?.id ?? null
        );
        setCurrentPath(urlRepository ? urlState.path : "");
        setSelectedFilePath(urlRepository ? urlState.file : "");
        setActiveTab(urlRepository ? urlState.tab : "Code");
        didApplyInitialUrl.current = true;
      } catch {
        if (mounted) {
          setErrorMessage("Failed to load recent repositories.");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadRepositories();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    loadDirectoryListing();
  }, []);

  useEffect(() => {
    function handlePopState() {
      const urlState = readUrlState();
      setSelectedRepositoryId(urlState.repositoryId || repositories[0]?.id || null);
      setCurrentPath(urlState.path);
      setSelectedFilePath(urlState.file);
      setActiveTab(urlState.tab);
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [repositories]);

  useEffect(() => {
    if (!selectedRepository) {
      setSummary(null);
      return;
    }

    let mounted = true;

    async function loadSummary() {
      try {
        const query = worktreeParam
          ? `?${new URLSearchParams({ worktree: worktreeParam })}`
          : "";
        const response = await fetch(
          `/api/repositories/${selectedRepository?.id}${query}`
        );
        const data = (await response.json()) as {
          summary?: RepositorySummary;
        };

        if (mounted) {
          setSummary(data.summary ?? null);
        }
      } catch {
        if (mounted) {
          setSummary(null);
        }
      }
    }

    loadSummary();

    return () => {
      mounted = false;
    };
  }, [selectedRepository, worktreeParam]);

  useEffect(() => {
    setSelectedWorktreePath("");

    if (!selectedRepository) {
      setWorktrees([]);
      return;
    }

    let mounted = true;

    async function loadWorktrees() {
      try {
        const response = await fetch(
          `/api/repositories/${selectedRepository?.id}/worktrees`
        );
        const data = (await response.json()) as {
          worktrees?: WorktreeSummary[];
        };

        if (mounted) {
          setWorktrees(
            (data.worktrees ?? []).filter((worktree) => !worktree.bare)
          );
        }
      } catch {
        if (mounted) {
          setWorktrees([]);
        }
      }
    }

    loadWorktrees();

    return () => {
      mounted = false;
    };
  }, [selectedRepository]);

  useEffect(() => {
    if (!didApplyInitialUrl.current) {
      return;
    }

    if (!selectedRepository) {
      setCurrentPath("");
      setSelectedFilePath("");
      setSelectedFile(null);
      replaceUrlState(null, "", "");
      return;
    }

    setEntries([]);
    setFileErrorMessage(null);
  }, [selectedRepository]);

  useEffect(() => {
    if (!selectedRepository) {
      return;
    }

    let mounted = true;

    async function loadRepositoryDirectory() {
      setIsFilesLoading(true);
      setFileErrorMessage(null);

      try {
        const searchParams = new URLSearchParams({ path: currentPath });
        if (worktreeParam) {
          searchParams.set("worktree", worktreeParam);
        }
        if (showHidden) {
          searchParams.set("hidden", "1");
        }
        const response = await fetch(
          `/api/repositories/${selectedRepository?.id}/files?${searchParams}`
        );
        const data = (await response.json()) as {
          entries?: FileEntry[];
          error?: {
            message?: string;
          };
        };

        if (!response.ok) {
          throw new Error(data.error?.message ?? "Failed to load files.");
        }

        if (mounted) {
          setEntries(data.entries ?? []);
        }
      } catch (error) {
        if (mounted) {
          setEntries([]);
          setFileErrorMessage(
            error instanceof Error ? error.message : "Failed to load files."
          );
        }
      } finally {
        if (mounted) {
          setIsFilesLoading(false);
        }
      }
    }

    loadRepositoryDirectory();

    return () => {
      mounted = false;
    };
  }, [selectedRepository, currentPath, worktreeParam, showHidden]);

  useEffect(() => {
    if (!selectedRepository || !selectedFilePath) {
      setSelectedFile(null);
      return;
    }

    let mounted = true;

    async function loadFile() {
      setIsFilesLoading(true);
      setFileErrorMessage(null);

      try {
        const searchParams = new URLSearchParams({ path: selectedFilePath });
        if (worktreeParam) {
          searchParams.set("worktree", worktreeParam);
        }
        const response = await fetch(
          `/api/repositories/${selectedRepository?.id}/file?${searchParams}`
        );
        const data = (await response.json()) as {
          file?: FileContent;
          error?: {
            message?: string;
          };
        };

        if (!response.ok || !data.file) {
          throw new Error(data.error?.message ?? "Failed to open file.");
        }

        if (mounted) {
          setSelectedFile(data.file);
        }
      } catch (error) {
        if (mounted) {
          setSelectedFile(null);
          setFileErrorMessage(
            error instanceof Error ? error.message : "Failed to open file."
          );
        }
      } finally {
        if (mounted) {
          setIsFilesLoading(false);
        }
      }
    }

    loadFile();

    return () => {
      mounted = false;
    };
  }, [selectedRepository, selectedFilePath, worktreeParam]);

  // GitHub-style: when browsing a directory, render its README below the file
  // list. Only fetch when not viewing a file and a Markdown README is present.
  useEffect(() => {
    const readmeEntry = selectedFilePath ? null : findReadmeEntry(entries);

    if (!selectedRepository || !readmeEntry) {
      setReadmeFile(null);
      return;
    }

    let mounted = true;

    async function loadReadme() {
      try {
        const searchParams = new URLSearchParams({ path: readmeEntry!.path });
        if (worktreeParam) {
          searchParams.set("worktree", worktreeParam);
        }
        const response = await fetch(
          `/api/repositories/${selectedRepository?.id}/file?${searchParams}`
        );
        const data = (await response.json()) as { file?: FileContent };

        if (mounted) {
          setReadmeFile(response.ok && data.file ? data.file : null);
        }
      } catch {
        if (mounted) {
          setReadmeFile(null);
        }
      }
    }

    loadReadme();

    return () => {
      mounted = false;
    };
  }, [selectedRepository, selectedFilePath, worktreeParam, entries]);

  async function loadDirectoryListing(path?: string) {
    setIsDirectoryLoading(true);
    setDirectoryErrorMessage(null);

    try {
      const searchParams = path ? `?${new URLSearchParams({ path })}` : "";
      const response = await fetch(`/api/directories${searchParams}`);
      const data = (await response.json()) as
        | DirectoryListing
        | {
            error?: {
              message?: string;
            };
          };

      if (!response.ok || !("directories" in data)) {
        throw new Error(
          "error" in data
            ? data.error?.message ?? "Failed to load directories."
            : "Failed to load directories."
        );
      }

      setDirectoryListing(data);
    } catch (error) {
      setDirectoryErrorMessage(
        error instanceof Error ? error.message : "Failed to load directories."
      );
    } finally {
      setIsDirectoryLoading(false);
    }
  }

  async function openRepositoryPath(path: string) {
    setIsOpening(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/repositories/open", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ path })
      });
      const data = (await response.json()) as {
        repository?: RecentRepository;
        error?: {
          message?: string;
        };
      };

      if (!response.ok || !data.repository) {
        throw new Error(data.error?.message ?? "Failed to open repository.");
      }

      const openedRepository = data.repository;

      setRepositories((current) => {
        const filtered = current.filter(
          (repository) => repository.id !== openedRepository.id
        );
        return [openedRepository, ...filtered];
      });
      setSelectedRepositoryId(openedRepository.id);
      setView("repository");
      setActiveTab("Code");
      setCurrentPath("");
      setSelectedFilePath("");
      setSelectedFile(null);
      setIsSidebarOpen(false);
      setIsRepositoryPickerOpen(false);
      pushUrlState(openedRepository.id, "", "");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to open repository."
      );
    } finally {
      setIsOpening(false);
    }
  }

  async function handleOpenEntry(entry: FileEntry) {
    if (entry.type === "directory") {
      handleNavigateDirectory(entry.path);
      return;
    }

    if (!selectedRepository) {
      return;
    }

    setSelectedFilePath(entry.path);
    pushUrlState(selectedRepository.id, currentPath, entry.path);
  }

  function handleNavigateDirectory(path: string) {
    setActiveTab("Code");
    setCurrentPath(path);
    setSelectedFilePath("");
    setSelectedFile(null);
    pushUrlState(selectedRepository?.id ?? null, path, "");
  }

  function handleOpenFilePath(filePath: string) {
    if (!selectedRepository) {
      return;
    }

    const lastSlash = filePath.lastIndexOf("/");
    const directory = lastSlash === -1 ? "" : filePath.slice(0, lastSlash);

    setActiveTab("Code");
    setCurrentPath(directory);
    setSelectedFilePath(filePath);
    setSelectedFile(null);
    pushUrlState(selectedRepository.id, directory, filePath);
  }

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    pushUrlState(
      selectedRepository?.id ?? null,
      currentPath,
      selectedFilePath,
      tab
    );
  }

  function handleSelectWorktree(worktreePath: string) {
    setSelectedWorktreePath(
      worktreePath === selectedRepository?.path ? "" : worktreePath
    );
    setCurrentPath("");
    setSelectedFilePath("");
    setSelectedFile(null);
    pushUrlState(selectedRepository?.id ?? null, "", "");
  }

  function handleSelectRepository(repository: RecentRepository) {
    setSelectedRepositoryId(repository.id);
    setView("repository");
    setCurrentPath("");
    setSelectedFilePath("");
    setSelectedFile(null);
    pushUrlState(repository.id, "", "");
    setIsSidebarOpen(false);

    // Persist recency without reordering the list mid-session; the new order
    // takes effect on the next load.
    void fetch(`/api/repositories/${repository.id}/touch`, { method: "POST" });
  }

  function handleOpenAgentWorktree(cwd: string) {
    openRepositoryPath(cwd);
  }

  function handleRemoveRepository(repository: RecentRepository) {
    setRepositories((current) =>
      current.filter((entry) => entry.id !== repository.id)
    );
    if (selectedRepositoryId === repository.id) {
      setSelectedRepositoryId(null);
      setCurrentPath("");
      setSelectedFilePath("");
      setSelectedFile(null);
    }
    void fetch(`/api/repositories/${repository.id}`, { method: "DELETE" });
  }

  const sidebar = (
    <SidebarContent
      isAgentsActive={view === "agents"}
      isLoading={isLoading}
      repositories={repositories}
      selectedRepository={view === "agents" ? null : selectedRepository}
      onOpenAgents={() => {
        setView("agents");
        setIsSidebarOpen(false);
      }}
      onOpenPicker={() => setIsRepositoryPickerOpen(true)}
      onSelectRepository={handleSelectRepository}
      onRemoveRepository={handleRemoveRepository}
    />
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-border bg-sidebar md:flex",
          isSidebarCollapsed && "md:hidden"
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        <SheetContent
          side="left"
          className="w-72 bg-sidebar p-0 sm:max-w-72"
          showCloseButton={false}
        >
          {sidebar}
        </SheetContent>
      </Sheet>

      <RepositoryPickerDialog
        directoryErrorMessage={directoryErrorMessage}
        directoryListing={directoryListing}
        isDirectoryLoading={isDirectoryLoading}
        isOpening={isOpening}
        open={isRepositoryPickerOpen}
        openErrorMessage={errorMessage}
        onBrowse={loadDirectoryListing}
        onOpenChange={setIsRepositoryPickerOpen}
        onOpenRepository={openRepositoryPath}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur supports-backdrop-filter:bg-background/60">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle navigation"
            onClick={() => {
              if (window.matchMedia("(max-width: 767px)").matches) {
                setIsSidebarOpen(true);
                return;
              }

              setIsSidebarCollapsed((current) => !current);
            }}
          >
            <Menu />
          </Button>
          <div className="hidden flex-1 items-center rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground sm:flex">
            Search or jump to...
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            localhost
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {view === "agents" ? (
            <AgentsView onOpenWorktree={handleOpenAgentWorktree} />
          ) : (
          <RepositoryView
            activeTab={activeTab}
            currentPath={currentPath}
            entries={entries}
            showHidden={showHidden}
            onToggleHidden={() => setShowHidden((value) => !value)}
            fileErrorMessage={fileErrorMessage}
            isFilesLoading={isFilesLoading}
            selectedFile={selectedFile}
            selectedFilePath={selectedFilePath}
            readmeFile={readmeFile}
            selectedRepository={selectedRepository}
            selectedWorktreePath={selectedWorktreePath}
            summary={summary}
            worktreeParam={worktreeParam}
            worktrees={worktrees}
            onNavigateDirectory={handleNavigateDirectory}
            onOpenEntry={handleOpenEntry}
            onOpenFilePath={handleOpenFilePath}
            onOpenWorktreePath={handleOpenAgentWorktree}
            onSelectWorktree={handleSelectWorktree}
            onTabChange={handleTabChange}
          />
          )}
        </div>
      </section>
    </div>
  );
}

function SidebarContent({
  isAgentsActive,
  isLoading,
  repositories,
  selectedRepository,
  onOpenAgents,
  onOpenPicker,
  onSelectRepository,
  onRemoveRepository
}: {
  isAgentsActive: boolean;
  isLoading: boolean;
  repositories: RecentRepository[];
  selectedRepository: RecentRepository | null;
  onOpenAgents: () => void;
  onOpenPicker: () => void;
  onSelectRepository: (repository: RecentRepository) => void;
  onRemoveRepository: (repository: RecentRepository) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Smartphone size={16} />
        </span>
        <span className="font-semibold">Pocket Repo</span>
      </div>

      <Separator />

      <div className="flex flex-col gap-2 px-3 pt-3">
        <Button className="w-full" variant="outline" onClick={onOpenPicker}>
          Open project
        </Button>
        <button
          type="button"
          onClick={onOpenAgents}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent",
            isAgentsActive && "bg-sidebar-accent text-sidebar-accent-foreground"
          )}
        >
          <Bot size={16} className="text-muted-foreground" />
          Agents
        </button>
      </div>

      <div className="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Recent
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        {isLoading ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            Loading repositories...
          </div>
        ) : repositories.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            No repositories opened yet.
          </div>
        ) : (
          <RecentRepositoryGroups
            repositories={repositories}
            selectedRepository={selectedRepository}
            onSelectRepository={onSelectRepository}
            onRemoveRepository={onRemoveRepository}
          />
        )}
      </ScrollArea>
    </div>
  );
}

function groupRepositoriesByRepo(repositories: RecentRepository[]) {
  const groups = new Map<
    string,
    { key: string; repoName: string; entries: RecentRepository[] }
  >();

  for (const repository of repositories) {
    const key = repository.repoRoot ?? repository.path;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(repository);
    } else {
      groups.set(key, {
        key,
        repoName: repository.repoName ?? repository.name,
        entries: [repository]
      });
    }
  }

  for (const group of groups.values()) {
    group.entries.sort((a, b) => {
      if (Boolean(a.isMainWorktree) !== Boolean(b.isMainWorktree)) {
        return a.isMainWorktree ? -1 : 1;
      }
      return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
    });
  }

  return Array.from(groups.values()).sort((a, b) => {
    const aRecent = a.entries[0]?.lastOpenedAt ?? "";
    const bRecent = b.entries[0]?.lastOpenedAt ?? "";
    return bRecent.localeCompare(aRecent);
  });
}

function entryLabel(entry: RecentRepository) {
  if (entry.isMainWorktree) {
    return entry.branch ?? "main";
  }
  return entry.branch ?? entry.worktreeRelative ?? entry.name;
}

function entrySubLabel(entry: RecentRepository) {
  if (entry.isMainWorktree) {
    return "main worktree";
  }
  return entry.worktreeRelative ?? entry.path;
}

function RecentItemMenu({
  onRemove
}: {
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Recent item actions"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-sidebar-accent aria-expanded:text-foreground"
      >
        <MoreVertical size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onClick={onRemove}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 size={14} />
          Remove from recent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RecentRepositoryGroups({
  repositories,
  selectedRepository,
  onSelectRepository,
  onRemoveRepository
}: {
  repositories: RecentRepository[];
  selectedRepository: RecentRepository | null;
  onSelectRepository: (repository: RecentRepository) => void;
  onRemoveRepository: (repository: RecentRepository) => void;
}) {
  const groups = groupRepositoriesByRepo(repositories);
  // Collapsed by default: track which groups the user has explicitly expanded.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-1 pb-4">
      {groups.map((group) => {
        // Every repository uses the same row: a chevron (when it has linked
        // worktrees), the repo name, and a worktree count. The primary entry
        // (its main worktree) is what the row opens.
        const primary = group.entries[0];
        const hasWorktrees = group.entries.length > 1;
        const isExpanded = expandedKeys.has(group.key);
        const groupHasSelected = group.entries.some(
          (entry) => entry.id === selectedRepository?.id
        );

        return (
          <div key={group.key} className="flex flex-col">
            <div
              className={cn(
                "flex items-center rounded-md transition-colors hover:bg-sidebar-accent",
                !isExpanded &&
                  groupHasSelected &&
                  "bg-sidebar-accent text-sidebar-accent-foreground"
              )}
            >
              {hasWorktrees ? (
                <button
                  type="button"
                  aria-label={isExpanded ? "Collapse worktrees" : "Expand worktrees"}
                  onClick={() => toggleGroup(group.key)}
                  className="flex shrink-0 items-center self-stretch rounded-l-md px-1.5 text-muted-foreground hover:text-foreground"
                >
                  {isExpanded ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ChevronRight size={15} />
                  )}
                </button>
              ) : (
                <span className="w-[27px] shrink-0" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => onSelectRepository(primary)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pr-1 text-left"
              >
                <span className="truncate text-sm font-medium">
                  {group.repoName}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {primary.path}
                </span>
              </button>
              {hasWorktrees ? (
                <span className="shrink-0 rounded-full bg-sidebar-accent px-1.5 text-xs text-muted-foreground">
                  {group.entries.length}
                </span>
              ) : null}
              <RecentItemMenu onRemove={() => onRemoveRepository(primary)} />
            </div>

            {hasWorktrees && isExpanded ? (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center rounded-md transition-colors hover:bg-sidebar-accent",
                      entry.id === selectedRepository?.id &&
                        "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectRepository(entry)}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left"
                    >
                      <span className="truncate text-sm">
                        {entryLabel(entry)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {entrySubLabel(entry)}
                      </span>
                    </button>
                    <RecentItemMenu
                      onRemove={() => onRemoveRepository(entry)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RepositoryPickerDialog({
  directoryErrorMessage,
  directoryListing,
  isDirectoryLoading,
  isOpening,
  open,
  openErrorMessage,
  onBrowse,
  onOpenChange,
  onOpenRepository
}: {
  directoryErrorMessage: string | null;
  directoryListing: DirectoryListing | null;
  isDirectoryLoading: boolean;
  isOpening: boolean;
  open: boolean;
  openErrorMessage: string | null;
  onBrowse: (path?: string) => void;
  onOpenChange: (open: boolean) => void;
  onOpenRepository: (path: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open project</DialogTitle>
          <DialogDescription>
            Select any folder under your home directory. Git repositories are
            marked, but plain folders can be opened too.
          </DialogDescription>
        </DialogHeader>
        <DirectoryBrowser
          directoryErrorMessage={directoryErrorMessage}
          directoryListing={directoryListing}
          isDirectoryLoading={isDirectoryLoading}
          isOpening={isOpening}
          onBrowse={onBrowse}
          onOpenRepository={onOpenRepository}
        />
        {openErrorMessage ? (
          <p className="text-sm text-destructive">{openErrorMessage}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DirectoryBrowser({
  directoryErrorMessage,
  directoryListing,
  isDirectoryLoading,
  isOpening,
  onBrowse,
  onOpenRepository
}: {
  directoryErrorMessage: string | null;
  directoryListing: DirectoryListing | null;
  isDirectoryLoading: boolean;
  isOpening: boolean;
  onBrowse: (path?: string) => void;
  onOpenRepository: (path: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!directoryListing?.parentPath}
          onClick={() => onBrowse(directoryListing?.parentPath ?? undefined)}
          aria-label="Go to parent folder"
        >
          <ChevronLeft />
        </Button>
        <span className="truncate text-sm text-muted-foreground">
          {directoryListing ? compactHomePath(directoryListing) : "Home"}
        </span>
      </div>

      {directoryErrorMessage ? (
        <div className="text-sm text-destructive">{directoryErrorMessage}</div>
      ) : null}

      <Button
        className="w-full"
        disabled={!directoryListing || isOpening}
        onClick={() => {
          if (directoryListing) {
            onOpenRepository(directoryListing.path);
          }
        }}
      >
        {isOpening ? <Loader2 className="animate-spin" /> : null}
        {directoryListing?.isRepository
          ? "Open this repository"
          : "Open this folder"}
      </Button>

      <ScrollArea className="h-64 rounded-md border border-border">
        <div className="flex flex-col p-1">
          {isDirectoryLoading && !directoryListing ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              Loading folders...
            </div>
          ) : directoryListing?.directories.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              No folders here.
            </div>
          ) : (
            directoryListing?.directories.map((directory) => (
              <button
                key={directory.path}
                type="button"
                onClick={() => {
                  if (directory.isRepository) {
                    onOpenRepository(directory.path);
                    return;
                  }

                  onBrowse(directory.path);
                }}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Folder size={15} className="text-muted-foreground" />
                <span className="flex-1 truncate">{directory.name}</span>
                {directory.isRepository ? (
                  <Badge variant="secondary">repo</Badge>
                ) : null}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function RepositoryView({
  activeTab,
  currentPath,
  entries,
  showHidden,
  onToggleHidden,
  fileErrorMessage,
  isFilesLoading,
  selectedFile,
  selectedFilePath,
  readmeFile,
  selectedRepository,
  selectedWorktreePath,
  summary,
  worktreeParam,
  worktrees,
  onNavigateDirectory,
  onOpenEntry,
  onOpenFilePath,
  onOpenWorktreePath,
  onSelectWorktree,
  onTabChange
}: {
  activeTab: string;
  currentPath: string;
  entries: FileEntry[];
  showHidden: boolean;
  onToggleHidden: () => void;
  fileErrorMessage: string | null;
  isFilesLoading: boolean;
  selectedFile: FileContent | null;
  selectedFilePath: string;
  readmeFile: FileContent | null;
  selectedRepository: RecentRepository | null;
  selectedWorktreePath: string;
  summary: RepositorySummary | null;
  worktreeParam: string;
  worktrees: WorktreeSummary[];
  onNavigateDirectory: (path: string) => void;
  onOpenEntry: (entry: FileEntry) => void;
  onOpenFilePath: (filePath: string) => void;
  onOpenWorktreePath: (cwd: string) => void;
  onSelectWorktree: (worktreePath: string) => void;
  onTabChange: (tab: string) => void;
}) {
  const isViewingFile = Boolean(selectedFilePath);
  const openFileName =
    selectedFile?.name ?? selectedFilePath.split("/").filter(Boolean).pop() ?? "";
  const activeWorktreePath = selectedWorktreePath || selectedRepository?.path || "";
  const hasWorktreeSwitcher = worktrees.length > 1;
  const repositoryId = selectedRepository?.id ?? null;

  // Absolute on-disk path for a repo-relative path, for the copy-path buttons.
  function toAbsolutePath(relativePath: string) {
    const base = activeWorktreePath.replace(/\/+$/, "");
    return relativePath ? `${base}/${relativePath}` : base;
  }

  function buildRawUrl(filePath: string) {
    const params = new URLSearchParams({ path: filePath });
    if (worktreeParam) {
      params.set("worktree", worktreeParam);
    }
    return `/api/repositories/${repositoryId}/raw?${params}`;
  }

  function buildDownloadUrl(filePath: string) {
    const params = new URLSearchParams();
    if (filePath) {
      params.set("path", filePath);
    }
    if (worktreeParam) {
      params.set("worktree", worktreeParam);
    }
    const query = params.toString();
    return `/api/repositories/${repositoryId}/download${query ? `?${query}` : ""}`;
  }

  function buildPathUrl(base: string, filePath: string) {
    const encodedPath = filePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const suffix = worktreeParam
      ? `?${new URLSearchParams({ worktree: worktreeParam })}`
      : "";
    return `/api/${base}/${repositoryId}/${encodedPath}${suffix}`;
  }

  function buildRenderUrl(filePath: string) {
    return buildPathUrl("render", filePath);
  }

  function buildMarpUrl(filePath: string) {
    return buildPathUrl("render-marp", filePath);
  }

  function buildOfficeUrl(filePath: string) {
    return buildPathUrl("render-office", filePath);
  }

  function handleOpenFromTab(entryPath: string) {
    if (entryPath.endsWith("/")) {
      onNavigateDirectory(entryPath.replace(/\/+$/, ""));
      return;
    }

    onOpenFilePath(entryPath);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">
            {selectedRepository?.name ?? "Pocket Repo"}
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Read-only</Badge>
            {summary && !summary.isGitRepository ? (
              <Badge variant="secondary">Not a Git repository</Badge>
            ) : summary?.isGitRepository ? (
              <Badge variant={summary.dirty ? "default" : "secondary"}>
                {summary.dirty ? `${summary.changedFileCount} changed` : "Clean"}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <p className="truncate text-sm text-muted-foreground">
            {selectedRepository?.path ?? "Open a local project to begin."}
          </p>
          {selectedRepository ? (
            <PathActionsMenu
              absolutePath={activeWorktreePath}
              downloadUrl={buildDownloadUrl("")}
              isDirectory
              className="-my-1"
            />
          ) : null}
        </div>
      </section>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value) {
            onTabChange(value);
          }
        }}
        className="mt-4"
      >
        <TabsList className="max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.label} value={tab.label}>
                <Icon size={16} />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="mt-4">
        {activeTab === "Code" ? (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {hasWorktreeSwitcher ? (
              <Select
                value={activeWorktreePath}
                onValueChange={(value) => {
                  if (value) {
                    onSelectWorktree(value);
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Switch worktree"
                  className="max-w-[180px] sm:max-w-[240px]"
                >
                  <GitBranch size={16} className="shrink-0 text-muted-foreground" />
                  <SelectValue className="min-w-0">
                    {(value) => (
                      <span className="truncate">
                        {worktreeLabel(
                          worktrees.find((worktree) => worktree.path === value) ??
                            null
                        )}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  align="start"
                  className="w-[min(380px,calc(100vw-2rem))]"
                >
                  {worktrees.map((worktree) => {
                    const relativePath = worktreeRelativePath(
                      worktree,
                      selectedRepository?.path ?? ""
                    );
                    return (
                      <SelectItem key={worktree.path} value={worktree.path}>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">
                            {worktreeLabel(worktree)}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {relativePath || "(repository root)"}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : summary?.isGitRepository ? (
              <Button variant="outline" size="sm">
                <GitBranch size={16} />
                {summary.currentBranch ?? "detached"}
              </Button>
            ) : null}
            <Breadcrumb className="min-w-0 flex-1">
              <BreadcrumbList>
                <BreadcrumbItem>
                  {!currentPath && !isViewingFile ? (
                    <BreadcrumbPage>
                      {selectedRepository?.name ?? "root"}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      render={
                        <button
                          type="button"
                          onClick={() => onNavigateDirectory("")}
                        />
                      }
                    >
                      {selectedRepository?.name ?? "root"}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {getBreadcrumbs(currentPath).map((crumb) => {
                  const isActive = crumb.path === currentPath && !isViewingFile;
                  return (
                    <BreadcrumbItem key={crumb.path}>
                      <BreadcrumbSeparator />
                      {isActive ? (
                        <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink
                          render={
                            <button
                              type="button"
                              onClick={() => onNavigateDirectory(crumb.path)}
                            />
                          }
                        >
                          {crumb.name}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  );
                })}
                {isViewingFile ? (
                  <BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbPage>{openFileName}</BreadcrumbPage>
                  </BreadcrumbItem>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
            {isViewingFile ? (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => onNavigateDirectory(currentPath)}
              >
                <ChevronLeft size={16} />
                Back to files
              </Button>
            ) : null}
          </div>

          {isViewingFile ? (
            <Card className="overflow-hidden py-0">
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-sm font-medium">
                {selectedFile?.language === "markdown" ? (
                  <BookOpen size={16} className="text-muted-foreground" />
                ) : (
                  <File size={16} className="text-muted-foreground" />
                )}
                <span className="truncate">{openFileName}</span>
                {selectedFile ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatBytes(selectedFile.size)}
                  </span>
                ) : null}
                <PathActionsMenu
                  relativePath={selectedFilePath}
                  absolutePath={toAbsolutePath(selectedFilePath)}
                  downloadUrl={buildDownloadUrl(selectedFilePath)}
                  className={selectedFile ? "" : "ml-auto"}
                />
              </div>
              <div className="p-4">
                {isFilesLoading && !selectedFile ? (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <Skeleton key={index} className="h-4 w-full" />
                    ))}
                  </div>
                ) : fileErrorMessage ? (
                  <p className="text-sm text-destructive">{fileErrorMessage}</p>
                ) : selectedFile ? (
                  <FilePreview
                    file={selectedFile}
                    buildRawUrl={buildRawUrl}
                    buildRenderUrl={buildRenderUrl}
                    buildMarpUrl={buildMarpUrl}
                    buildOfficeUrl={buildOfficeUrl}
                    onOpenFile={onOpenFilePath}
                  />
                ) : null}
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
            <Card className="overflow-hidden py-0">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>Name</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onToggleHidden}
                    aria-pressed={showHidden}
                    title={
                      showHidden
                        ? "Hide gitignored files"
                        : "Show gitignored files"
                    }
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    <span className="hidden sm:inline">Hidden</span>
                  </button>
                  <span>Size</span>
                </div>
              </div>
              {isFilesLoading && entries.length === 0 ? (
                <div className="flex flex-col gap-2 p-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-7 w-full" />
                  ))}
                </div>
              ) : fileErrorMessage ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {fileErrorMessage}
                </div>
              ) : !selectedRepository ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Pick a repository from the sidebar to view files.
                </div>
              ) : entries.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No files in this directory.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {entries.map((entry) => {
                    const Icon = entry.type === "directory" ? Folder : File;
                    return (
                      <div
                        key={entry.path}
                        className={`group flex items-center gap-1 pr-2 transition-colors hover:bg-muted/50 ${
                          entry.ignored ? "opacity-50" : ""
                        }`}
                        title={entry.ignored ? "Gitignored" : undefined}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenEntry(entry)}
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-2.5 text-left text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon
                              size={16}
                              className="shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{entry.name}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {entry.type === "directory"
                              ? "directory"
                              : formatBytes(entry.size ?? 0)}
                          </span>
                        </button>
                        <PathActionsMenu
                          relativePath={entry.path}
                          absolutePath={toAbsolutePath(entry.path)}
                          downloadUrl={buildDownloadUrl(entry.path)}
                          isDirectory={entry.type === "directory"}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            {readmeFile?.content ? (
              <Card className="overflow-hidden py-0">
                <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-sm font-medium">
                  <BookOpen size={16} className="text-muted-foreground" />
                  <span className="truncate">{readmeFile.name}</span>
                </div>
                <div className="p-4">
                  <MarkdownView
                    content={readmeFile.content}
                    baseDir={currentPath}
                    buildRawUrl={buildRawUrl}
                    onOpenFile={onOpenFilePath}
                  />
                </div>
              </Card>
            ) : null}
            </div>
          )}
        </div>
        ) : activeTab === "Status" ? (
          <StatusTab
            repositoryId={repositoryId}
            worktreeParam={worktreeParam}
            isGitRepository={summary?.isGitRepository ?? true}
            onOpenFile={handleOpenFromTab}
          />
        ) : activeTab === "Search" ? (
          <SearchTab
            repositoryId={repositoryId}
            worktreeParam={worktreeParam}
            onOpenFile={handleOpenFromTab}
          />
        ) : activeTab === "Agents" ? (
          <RepoAgentsTab
            repositoryId={repositoryId}
            repositoryName={selectedRepository?.name ?? "project"}
            repositoryPath={selectedRepository?.path ?? null}
            worktreeParam={worktreeParam}
            onOpenWorktree={onOpenWorktreePath}
          />
        ) : (
          <SettingsTab
            activeWorktreePath={activeWorktreePath}
            repository={selectedRepository}
            summary={summary}
          />
        )}
      </div>
    </div>
  );
}

type StatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
};

function statusDescriptor(entry: StatusEntry) {
  if (entry.untracked) {
    return { label: "Untracked", badge: "U", tone: "text-emerald-400" };
  }

  const code = (entry.indexStatus + entry.worktreeStatus).replace(/ /g, "");

  if (code.includes("D")) {
    return { label: "Deleted", badge: "D", tone: "text-red-400" };
  }
  if (code.includes("R")) {
    return { label: "Renamed", badge: "R", tone: "text-sky-400" };
  }
  if (code.includes("A")) {
    return { label: "Added", badge: "A", tone: "text-emerald-400" };
  }
  if (code.includes("M")) {
    return { label: "Modified", badge: "M", tone: "text-amber-400" };
  }

  return { label: "Changed", badge: code || "?", tone: "text-muted-foreground" };
}

const WORKING_TREE = "__working_tree__";

function StatusTab({
  repositoryId,
  worktreeParam,
  isGitRepository,
  onOpenFile
}: {
  repositoryId: string | null;
  worktreeParam: string;
  isGitRepository: boolean;
  onOpenFile: (filePath: string) => void;
}) {
  const [entries, setEntries] = useState<StatusEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [compareBase, setCompareBase] = useState<string>(WORKING_TREE);

  // Reset the comparison when switching repository or worktree.
  useEffect(() => {
    setCompareBase(WORKING_TREE);
  }, [repositoryId, worktreeParam]);

  useEffect(() => {
    if (!repositoryId) {
      setBranches([]);
      return;
    }

    let mounted = true;

    async function loadBranches() {
      try {
        const searchParams = new URLSearchParams();
        if (worktreeParam) {
          searchParams.set("worktree", worktreeParam);
        }
        const query = searchParams.toString();
        const response = await fetch(
          `/api/repositories/${repositoryId}/branches${query ? `?${query}` : ""}`
        );
        const data = (await response.json()) as { branches?: string[] };

        if (mounted) {
          setBranches(data.branches ?? []);
        }
      } catch {
        if (mounted) {
          setBranches([]);
        }
      }
    }

    loadBranches();

    return () => {
      mounted = false;
    };
  }, [repositoryId, worktreeParam]);

  useEffect(() => {
    if (!repositoryId) {
      setEntries([]);
      setIsLoading(false);
      return;
    }

    let mounted = true;
    setIsLoading(true);
    setErrorMessage(null);

    async function loadEntries() {
      try {
        const searchParams = new URLSearchParams();
        if (worktreeParam) {
          searchParams.set("worktree", worktreeParam);
        }
        const isDiff = compareBase !== WORKING_TREE;
        if (isDiff) {
          searchParams.set("base", compareBase);
        }
        const query = searchParams.toString();
        const endpoint = isDiff ? "diff" : "status";
        const response = await fetch(
          `/api/repositories/${repositoryId}/${endpoint}${
            query ? `?${query}` : ""
          }`
        );
        const data = (await response.json()) as {
          entries?: StatusEntry[];
          error?: { message?: string };
        };

        if (!response.ok) {
          throw new Error(data.error?.message ?? "Failed to load changes.");
        }

        if (mounted) {
          setEntries(data.entries ?? []);
        }
      } catch (error) {
        if (mounted) {
          setEntries([]);
          setErrorMessage(
            error instanceof Error ? error.message : "Failed to load changes."
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadEntries();

    return () => {
      mounted = false;
    };
  }, [repositoryId, worktreeParam, compareBase]);

  const isDiff = compareBase !== WORKING_TREE;
  const emptyMessage = isDiff
    ? `No differences from ${compareBase}.`
    : "Working tree clean — no changes.";

  if (!isGitRepository) {
    return (
      <Card className="overflow-hidden py-0">
        <div className="p-6 text-center text-sm text-muted-foreground">
          This project is not a Git repository, so there are no changes or
          branches to show.
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
        <Select value={compareBase} onValueChange={(value) => value && setCompareBase(value)}>
          <SelectTrigger size="sm" aria-label="Compare against" className="max-w-[220px]">
            <GitCompare size={14} className="shrink-0 text-muted-foreground" />
            <SelectValue>
              {(value) =>
                value === WORKING_TREE ? "Working tree" : `vs ${value}`
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            align="start"
            className="w-[min(320px,calc(100vw-2rem))]"
          >
            <SelectItem value={WORKING_TREE}>Working tree (uncommitted)</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch}>
                <span className="truncate">vs {branch}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs font-medium text-muted-foreground">
          {entries.length > 0 ? `${entries.length} files` : ""}
        </span>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : errorMessage ? (
        <div className="p-6 text-center text-sm text-destructive">
          {errorMessage}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {entries.map((entry) => {
            const descriptor = statusDescriptor(entry);
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => onOpenFile(entry.path)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                title={descriptor.label}
              >
                <span
                  className={cn(
                    "w-4 shrink-0 text-center font-mono text-xs font-semibold",
                    descriptor.tone
                  )}
                >
                  {descriptor.badge}
                </span>
                <span className="truncate">{entry.path}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {descriptor.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function SearchTab({
  repositoryId,
  worktreeParam,
  onOpenFile
}: {
  repositoryId: string | null;
  worktreeParam: string;
  onOpenFile: (filePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();

    if (!repositoryId || !trimmed) {
      setResults([]);
      setHasSearched(false);
      setIsLoading(false);
      return;
    }

    let mounted = true;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const searchParams = new URLSearchParams({ q: trimmed });
        if (worktreeParam) {
          searchParams.set("worktree", worktreeParam);
        }
        const response = await fetch(
          `/api/repositories/${repositoryId}/search?${searchParams}`
        );
        const data = (await response.json()) as { results?: string[] };

        if (mounted) {
          setResults(data.results ?? []);
          setHasSearched(true);
        }
      } catch {
        if (mounted) {
          setResults([]);
          setHasSearched(true);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [query, repositoryId, worktreeParam]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={16}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files by name..."
          className="pl-9"
          autoFocus
        />
      </div>

      <Card className="overflow-hidden py-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : !query.trim() ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Type to search file names in this repository.
          </div>
        ) : results.length === 0 && hasSearched ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No files match &ldquo;{query.trim()}&rdquo;.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {results.map((filePath) => {
              const name = filePath.split("/").pop() ?? filePath;
              const directory = filePath.includes("/")
                ? filePath.slice(0, filePath.length - name.length - 1)
                : "";
              return (
                <button
                  key={filePath}
                  type="button"
                  onClick={() => onOpenFile(filePath)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <File size={16} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                  {directory ? (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {directory}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function SettingsTab({
  activeWorktreePath,
  repository,
  summary
}: {
  activeWorktreePath: string;
  repository: RecentRepository | null;
  summary: RepositorySummary | null;
}) {
  const [configHome, setConfigHome] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const data = (await response.json()) as { configHome?: string };

        if (mounted) {
          setConfigHome(data.configHome ?? null);
        }
      } catch {
        if (mounted) {
          setConfigHome(null);
        }
      }
    }

    loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Repository</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SettingRow label="Name" value={repository?.name ?? "-"} />
          <SettingRow label="Path" value={repository?.path ?? "-"} mono />
          <SettingRow label="Active worktree" value={activeWorktreePath || "-"} mono />
          <SettingRow
            label="Current branch"
            value={summary?.currentBranch ?? "-"}
          />
          <div className="grid grid-cols-3 gap-2 pt-1 text-center">
            <SettingStat value={summary?.branchCount} label="branches" />
            <SettingStat value={summary?.worktreeCount} label="worktrees" />
            <SettingStat value={summary?.changedFileCount} label="changed" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SettingRow label="Mode" value="Read-only viewer" />
          <SettingRow label="Config home" value={configHome ?? "-"} mono />
          <p className="text-sm text-muted-foreground">
            Pocket Repo is a local read-only repository viewer. It never edits
            files or mutates Git state.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingRow({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm break-all", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function SettingStat({
  value,
  label
}: {
  value: number | string | null | undefined;
  label: string;
}) {
  return (
    <div className="rounded-md border border-border py-2">
      <div className="text-base font-semibold">{value ?? "-"}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "ico",
  "bmp"
];

// Pick the README to render under a directory listing, preferring a Markdown
// one. Mirrors GitHub's case-insensitive matching.
function findReadmeEntry(entries: FileEntry[]) {
  return (
    entries.find(
      (entry) =>
        entry.type === "file" && /^readme\.(md|markdown|mdx)$/i.test(entry.name)
    ) ?? null
  );
}

function isImagePath(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension ? IMAGE_EXTENSIONS.includes(extension) : false;
}

const PRESENTATION_EXTENSIONS = ["pptx", "ppt", "ppsx", "odp"];
const DOCUMENT_EXTENSIONS = ["docx", "doc", "odt", "rtf"];
const SPREADSHEET_EXTENSIONS = ["xlsx", "xls", "ods"];
const CONVERTIBLE_DOCUMENT_EXTENSIONS = [
  ...PRESENTATION_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...SPREADSHEET_EXTENSIONS
];

// Office documents that need a server-side LibreOffice conversion before they
// can be previewed as a PDF.
function isConvertibleDocumentPath(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension
    ? CONVERTIBLE_DOCUMENT_EXTENSIONS.includes(extension)
    : false;
}

// Native PDFs are previewed directly, without LibreOffice.
function isPdfPath(name: string) {
  return name.split(".").pop()?.toLowerCase() === "pdf";
}

// Copy text to the clipboard. Prefers the async Clipboard API (secure
// contexts) and falls back to a hidden textarea so it also works over plain
// LAN HTTP, where the Clipboard API is unavailable.
async function copyText(value: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

// A kebab (⋮) menu offering "download" plus "copy relative path" /
// "copy absolute path". Relative is the repo-relative path; absolute is the
// on-disk path. The relative item is omitted when there is no relative portion
// (e.g. the repo root). When a downloadUrl is given, a download item is shown —
// labelled "Download as ZIP" for directories. A brief toast confirms a copy.
function PathActionsMenu({
  relativePath,
  absolutePath,
  downloadUrl,
  isDirectory,
  className
}: {
  relativePath?: string;
  absolutePath: string;
  downloadUrl?: string;
  isDirectory?: boolean;
  className?: string;
}) {
  const [toast, setToast] = useState<string | null>(null);

  async function copy(value: string, kind: string) {
    if (await copyText(value)) {
      setToast(`Copied ${kind} path`);
      window.setTimeout(() => setToast(null), 1500);
    }
  }

  function download() {
    if (!downloadUrl) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.rel = "noopener";
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Path actions"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted aria-expanded:text-foreground",
            className
          )}
        >
          <MoreVertical size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {downloadUrl ? (
            <DropdownMenuItem onClick={download}>
              <Download size={14} />
              {isDirectory ? "Download as ZIP" : "Download"}
            </DropdownMenuItem>
          ) : null}
          {relativePath ? (
            <DropdownMenuItem onClick={() => copy(relativePath, "relative")}>
              <Copy size={14} />
              Copy relative path
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => copy(absolutePath, "absolute")}>
            <Copy size={14} />
            Copy absolute path
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {toast
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4">
              <div className="flex items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg">
                <Check size={14} />
                {toast}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function isExternalUrl(url: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
}

function resolveRepoRelativePath(baseDir: string, target: string) {
  if (!target || isExternalUrl(target) || target.startsWith("data:")) {
    return null;
  }

  const isRootRelative = target.startsWith("/");
  const combined = isRootRelative
    ? target.replace(/^\/+/, "")
    : baseDir
      ? `${baseDir}/${target}`
      : target;

  const segments: string[] = [];
  for (const segment of combined.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join("/");
}

// Render Markdown with GitHub-flavored extensions and embedded raw HTML
// (rehype-raw) so README tables/<img> render like on GitHub. Relative image
// sources and links are resolved against `baseDir` and rewritten to the /raw
// endpoint or to in-app navigation.
function MarkdownView({
  content,
  baseDir,
  buildRawUrl,
  onOpenFile
}: {
  content: string;
  baseDir: string;
  buildRawUrl: (filePath: string) => string;
  onOpenFile: (filePath: string) => void;
}) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          img: ({ src, alt }) => {
            const source = typeof src === "string" ? src : "";
            const resolved = resolveRepoRelativePath(baseDir, source);
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolved ? buildRawUrl(resolved) : source}
                alt={alt ?? ""}
                loading="lazy"
              />
            );
          },
          a: ({ href, children }) => {
            if (!href) {
              return <span>{children}</span>;
            }

            if (href.startsWith("#")) {
              return <a href={href}>{children}</a>;
            }

            if (isExternalUrl(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            }

            const [pathPart] = href.split("#");
            const resolved = resolveRepoRelativePath(baseDir, pathPart);

            if (!resolved) {
              return <a href={href}>{children}</a>;
            }

            return (
              <button
                type="button"
                onClick={() => onOpenFile(resolved)}
                className="text-primary underline underline-offset-4"
              >
                {children}
              </button>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Base sandbox tokens for rendered preview iframes. allow-same-origin is added
// only when the server opts into same-origin previews (see previewSandboxCsp on
// the backend) — both layers must agree, since the effective sandbox is the
// intersection of this attribute and the document's own CSP sandbox.
const PREVIEW_IFRAME_SANDBOX =
  "allow-scripts allow-popups allow-forms allow-modals allow-downloads";

// Cached across components so each preview doesn't re-fetch /api/capabilities.
let sameOriginPreviewCache: boolean | null = null;

function useSameOriginPreview() {
  const [enabled, setEnabled] = useState(sameOriginPreviewCache ?? false);

  useEffect(() => {
    if (sameOriginPreviewCache !== null) {
      return;
    }
    let active = true;
    fetch("/api/capabilities")
      .then((response) => response.json())
      .then((data: { sameOriginPreview?: boolean }) => {
        sameOriginPreviewCache = Boolean(data?.sameOriginPreview);
        if (active) {
          setEnabled(sameOriginPreviewCache);
        }
      })
      .catch(() => {
        // Capabilities are optional; fall back to the locked-down sandbox.
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
}

function previewIframeSandbox(sameOrigin: boolean) {
  return sameOrigin
    ? `allow-same-origin ${PREVIEW_IFRAME_SANDBOX}`
    : PREVIEW_IFRAME_SANDBOX;
}

function HtmlPreview({
  file,
  renderUrl
}: {
  file: FileContent;
  renderUrl: string;
}) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const sameOriginPreview = useSameOriginPreview();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setView("preview")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              view === "preview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setView("code")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              view === "code"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Code
          </button>
        </div>
        <a
          href={renderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink size={14} />
          Open in new tab
        </a>
      </div>
      {view === "preview" ? (
        <iframe
          src={renderUrl}
          title={file.name}
          sandbox={previewIframeSandbox(sameOriginPreview)}
          className="h-[70vh] w-full rounded-md border border-border bg-white"
        />
      ) : (
        <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
          <code>{file.content ?? ""}</code>
        </pre>
      )}
    </div>
  );
}

// Preview a Marp deck. Defaults to the rendered slides (sandboxed iframe), with
// toggles to read it as Markdown or view the raw source, plus a new-tab link.
function MarpPreview({
  file,
  slidesUrl,
  buildRawUrl,
  onOpenFile
}: {
  file: FileContent;
  slidesUrl: string;
  buildRawUrl: (filePath: string) => string;
  onOpenFile: (filePath: string) => void;
}) {
  const [view, setView] = useState<"slides" | "markdown" | "code">("slides");
  const sameOriginPreview = useSameOriginPreview();
  const baseDir = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";
  const tabs: Array<{ key: typeof view; label: string }> = [
    { key: "slides", label: "Slides" },
    { key: "markdown", label: "Markdown" },
    { key: "code", label: "Code" }
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                view === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <a
          href={slidesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink size={14} />
          Open in new tab
        </a>
      </div>
      {view === "slides" ? (
        <iframe
          src={slidesUrl}
          title={file.name}
          allow="fullscreen"
          sandbox={previewIframeSandbox(sameOriginPreview)}
          className="h-[70vh] w-full rounded-md border border-border bg-[#1a1a1a]"
        />
      ) : view === "markdown" ? (
        <MarkdownView
          content={file.content ?? ""}
          baseDir={baseDir}
          buildRawUrl={buildRawUrl}
          onOpenFile={onOpenFile}
        />
      ) : (
        <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
          <code>{file.content ?? ""}</code>
        </pre>
      )}
    </div>
  );
}

// Preview an office document or PDF in an iframe. Native PDFs (`needsLibreOffice`
// false) are served as-is; presentations and word-processor documents are
// rendered to PDF on the server. The PDF is fetched as a blob so that a failed
// conversion (e.g. a missing LibreOffice component) surfaces as a readable
// message with install guidance rather than a broken frame.
function DocumentPreview({
  file,
  pdfUrl,
  needsLibreOffice
}: {
  file: FileContent;
  pdfUrl: string;
  needsLibreOffice: boolean;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    url?: string;
    message?: string;
  }>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setState({ status: "loading" });

    fetch(pdfUrl)
      .then(async (response) => {
        if (!response.ok) {
          let message = "Failed to render this file.";
          try {
            const data = await response.json();
            if (data?.error?.message) {
              message = data.error.message;
            }
          } catch {
            // Non-JSON error body; keep the default message.
          }
          throw new Error(message);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setState({ status: "ready", url: objectUrl });
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      })
      .catch((error) => {
        if (active) {
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Failed to render this file."
          });
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [pdfUrl]);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={16} />
        {needsLibreOffice ? "Converting…" : "Loading…"}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Could not preview this document</p>
        <p className="text-muted-foreground">{state.message}</p>
        {needsLibreOffice ? (
          <>
            <p className="text-muted-foreground">
              Each file type needs its LibreOffice component: Writer for
              documents (<span className="font-mono">.docx</span>), Impress for
              presentations (<span className="font-mono">.pptx</span>), and Calc
              for spreadsheets (<span className="font-mono">.xlsx</span>).
            </p>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              <code>sudo apt install libreoffice</code>
            </pre>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {needsLibreOffice ? "Rendered to PDF via LibreOffice" : "PDF preview"}
        </span>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink size={14} />
          Open in new tab
        </a>
      </div>
      <iframe
        src={state.url}
        title={file.name}
        className="h-[75vh] w-full rounded-md border border-border bg-white"
      />
    </div>
  );
}

function FilePreview({
  file,
  buildRawUrl,
  buildRenderUrl,
  buildMarpUrl,
  buildOfficeUrl,
  onOpenFile
}: {
  file: FileContent;
  buildRawUrl: (filePath: string) => string;
  buildRenderUrl: (filePath: string) => string;
  buildMarpUrl: (filePath: string) => string;
  buildOfficeUrl: (filePath: string) => string;
  onOpenFile: (filePath: string) => void;
}) {
  if (isImagePath(file.name)) {
    return (
      <div className="flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={buildRawUrl(file.path)}
          alt={file.name}
          className="max-h-[70vh] max-w-full rounded-md"
        />
      </div>
    );
  }

  // Office documents and PDFs are binary, so handle them before the
  // binary/too-large fallbacks: PDFs are served inline and the office document
  // types are converted to PDF on the server.
  if (isConvertibleDocumentPath(file.name) || isPdfPath(file.name)) {
    return (
      <DocumentPreview
        file={file}
        pdfUrl={buildOfficeUrl(file.path)}
        needsLibreOffice={!isPdfPath(file.name)}
      />
    );
  }

  if (file.tooLarge) {
    return (
      <p className="text-sm text-muted-foreground">
        This file is larger than the current 1 MB preview limit.
      </p>
    );
  }

  if (file.binary) {
    return (
      <p className="text-sm text-muted-foreground">
        Binary files are not previewed.
      </p>
    );
  }

  if (file.isMarp && file.content) {
    return (
      <MarpPreview
        file={file}
        slidesUrl={buildMarpUrl(file.path)}
        buildRawUrl={buildRawUrl}
        onOpenFile={onOpenFile}
      />
    );
  }

  if (file.language === "markdown" && file.content) {
    const baseDir = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";

    return (
      <MarkdownView
        content={file.content}
        baseDir={baseDir}
        buildRawUrl={buildRawUrl}
        onOpenFile={onOpenFile}
      />
    );
  }

  if (file.language === "html") {
    return <HtmlPreview file={file} renderUrl={buildRenderUrl(file.path)} />;
  }

  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
      <code>{file.content ?? ""}</code>
    </pre>
  );
}

function worktreeRelativePath(worktree: WorktreeSummary, repositoryPath: string) {
  if (worktree.path === repositoryPath) {
    return "";
  }

  if (worktree.path.startsWith(`${repositoryPath}/`)) {
    return worktree.path.slice(repositoryPath.length + 1);
  }

  return worktree.path;
}

function worktreeLabel(worktree: WorktreeSummary | null) {
  if (!worktree) {
    return "worktree";
  }

  if (worktree.branch) {
    return worktree.branch;
  }

  if (worktree.detached && worktree.head) {
    return `detached @ ${worktree.head.slice(0, 7)}`;
  }

  return worktree.path.split("/").filter(Boolean).pop() ?? "worktree";
}

function getBreadcrumbs(currentPath: string) {
  if (!currentPath) {
    return [];
  }

  const segments = currentPath.split("/").filter(Boolean);

  return segments.map((name, index) => ({
    name,
    path: segments.slice(0, index + 1).join("/")
  }));
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function compactHomePath(listing: DirectoryListing) {
  if (listing.path === listing.home) {
    return "~";
  }

  return `~/${listing.path.slice(listing.home.length).replace(/^\/+/, "")}`;
}

function normalizeTab(value: string | null | undefined) {
  return tabs.some((tab) => tab.label === value) ? (value as string) : "Code";
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);

  return {
    repositoryId: params.get("repo") ?? "",
    path: params.get("path") ?? "",
    file: params.get("file") ?? "",
    tab: normalizeTab(params.get("tab"))
  };
}

function pushUrlState(
  repositoryId: string | null,
  path: string,
  file: string,
  tab = "Code"
) {
  updateUrlState(repositoryId, path, file, tab, "push");
}

function replaceUrlState(
  repositoryId: string | null,
  path: string,
  file: string,
  tab = "Code"
) {
  updateUrlState(repositoryId, path, file, tab, "replace");
}

function updateUrlState(
  repositoryId: string | null,
  path: string,
  file: string,
  tab: string,
  mode: "push" | "replace"
) {
  const url = new URL(window.location.href);
  url.search = "";

  if (repositoryId) {
    url.searchParams.set("repo", repositoryId);
  }

  if (path) {
    url.searchParams.set("path", path);
  }

  if (file) {
    url.searchParams.set("file", file);
  }

  if (tab && tab !== "Code") {
    url.searchParams.set("tab", tab);
  }

  if (mode === "replace") {
    window.history.replaceState(null, "", url);
    return;
  }

  window.history.pushState(null, "", url);
}
