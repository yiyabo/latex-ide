"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import {
  Check,
  ChevronLeft,
  Code2,
  Columns2,
  Eye,
  Loader2,
  Minus,
  Moon,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  Sun,
  X,
} from "lucide-react";
import type { FileTreeNode, CompileResult } from "@latex-ide/contracts";
import { useWorkbench } from "@/lib/stores/workbench";
import { FileTree } from "@/components/file-tree/FileTree";
import { LatexEditor, dispatchEditorReplace } from "@/components/editor/LatexEditor";
import { PdfPreview, CompileStatusBar } from "@/components/pdf/PdfPreview";
import { AiPanel } from "@/components/ai/AiPanel";
import { Toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const { status } = useSession();

  const {
    theme,
    setTheme,
    centerMode,
    setCenterMode,
    editorFontSize,
    setEditorFontSize,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    activeFile,
    openFiles,
    openFile,
    closeFile,
    compileStatus,
    setCompileStatus,
    compiling,
    setCompiling,
    setSaveState,
    showToast,
    selection,
  } = useWorkbench();

  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [fileContent, setFileContent] = useState("");
  const [versionId, setVersionId] = useState<string | undefined>();
  const [loadingFile, setLoadingFile] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [aiFixRequest, setAiFixRequest] = useState<{ id: string; message: string } | undefined>();
  const [projectName, setProjectName] = useState("");
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [savingProjectName, setSavingProjectName] = useState(false);
  const [desktopMode, setDesktopMode] = useState(false);
  const contentRef = useRef(fileContent);
  contentRef.current = fileContent;

  useEffect(() => {
    fetch("/api/app-info")
      .then((r) => r.json())
      .then((d) => {
        if (d?.desktop) return;
        if (status === "unauthenticated") router.replace("/login");
      })
      .catch(() => {
        if (status === "unauthenticated") router.replace("/login");
      });
  }, [status, router]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const loadTree = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/tree`);
    if (!res.ok) return;
    const data = await res.json();
    const nextTree: FileTreeNode[] = data.tree || [];
    setTree(nextTree);

    // Defense-in-depth: drop any restored open tabs that don't exist in THIS
    // project (stale localStorage from another project must not surface here).
    const valid = new Set<string>();
    const walk = (nodes: FileTreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "file") valid.add(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(nextTree);
    const st = useWorkbench.getState();
    const filtered = st.openFiles.filter((f) => valid.has(f));
    if (filtered.length !== st.openFiles.length) {
      useWorkbench.setState({
        openFiles: filtered,
        activeFile:
          st.activeFile && valid.has(st.activeFile)
            ? st.activeFile
            : (filtered[filtered.length - 1] ?? null),
      });
    } else if (st.activeFile && !valid.has(st.activeFile)) {
      useWorkbench.setState({
        activeFile: filtered[filtered.length - 1] ?? null,
      });
    }
  }, [projectId]);

  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.ok) {
      const data = await res.json();
      setProjectName(data.project?.name || "Project");
      if (data.project?.entryFile) openFile(data.project.entryFile);
    }
  }, [projectId, openFile]);

  useEffect(() => {
    fetch("/api/app-info")
      .then((r) => r.json())
      .then((d) => setDesktopMode(Boolean(d?.desktop)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Desktop loads project without a NextAuth session
    if (desktopMode) {
      void loadProject();
      void loadTree();
      return;
    }
    if (status !== "authenticated") return;
    void loadProject();
    void loadTree();
  }, [status, loadProject, loadTree, desktopMode]);

  // Load file content when activeFile changes
  useEffect(() => {
    if (!activeFile) {
      setFileContent("");
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(activeFile)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setFileContent(data.content || "");
        setVersionId(data.versionId);
      })
      .finally(() => !cancelled && setLoadingFile(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, activeFile]);

  const saveFile = useCallback(
    async (content: string, clientVersion?: string) => {
      if (!activeFile) return;
      setSaveState("saving");
      const res = await fetch(
        `/api/projects/${projectId}/files?path=${encodeURIComponent(activeFile)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, clientVersion }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setVersionId(data.versionId);
        setSaveState("saved");
      } else if (res.status === 409) {
        setSaveState("error");
        showToast("Save conflict — reload the file");
      } else {
        setSaveState("error");
      }
    },
    [projectId, activeFile, setSaveState, showToast],
  );

  const renameCurrentProject = useCallback(async () => {
    const nextName = projectNameDraft.trim();
    if (!nextName || savingProjectName) return;
    setSavingProjectName(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const data = await res.json();
      if (!res.ok || !data.project) {
        showToast(data.error || "重命名失败");
        return;
      }
      setProjectName(data.project.name);
      setEditingProjectName(false);
      showToast("项目名称已更新");
    } catch {
      showToast("重命名失败");
    } finally {
      setSavingProjectName(false);
    }
  }, [projectId, projectNameDraft, savingProjectName, showToast]);

  const compile = useCallback(async () => {
    setCompiling(true);
    try {
      // flush save
      await saveFile(contentRef.current, versionId);
      const res = await fetch(`/api/projects/${projectId}/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Compile failed to start");
        return;
      }
      const jobId = data.jobId as string;
      // poll
      const poll = async () => {
        const r = await fetch(`/api/compile/${jobId}`);
        const result = (await r.json()) as CompileResult;
        setCompileStatus(result);
        if (result.status === "queued" || result.status === "running") {
          setTimeout(poll, 700);
        } else {
          setCompiling(false);
          if (result.status === "success") {
            setPdfUrl(`/api/compile/${jobId}?download=1`);
            showToast("Compile succeeded");
          } else {
            showToast(`Compile ${result.status}`);
          }
        }
      };
      setTimeout(poll, 400);
    } catch {
      setCompiling(false);
      showToast("Compile error");
    }
  }, [projectId, saveFile, versionId, setCompiling, setCompileStatus, showToast]);

  // Global shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "a") {
        const target = e.target as HTMLElement | null;
        const editorOrInput =
          target?.closest(".cm-editor, textarea, input, [contenteditable='true']") ||
          document.activeElement?.closest?.(".cm-editor, textarea, input, [contenteditable='true']");
        if (!editorOrInput) e.preventDefault();
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        void compile();
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = document.querySelector<HTMLTextAreaElement>("#ai-assistant-input");
        el?.focus();
      }
      if (e.key === "Escape") {
        // clear selection display focus
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [compile]);

  const requestAiFix = useCallback(
    (diagnostic: { severity: string; filePath?: string; line?: number; message: string }) => {
      const location = diagnostic.filePath
        ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}` : ""}`
        : "当前编译结果";
      setRightCollapsed(false);
      setAiFixRequest({
        id: `${Date.now()}-${Math.random()}`,
        message: `请修复这条 LaTeX ${diagnostic.severity}：${location} — ${diagnostic.message}。请先分析原因，提交可审阅的最小 diff，接受后重新编译验证。`,
      });
    },
    [setRightCollapsed],
  );

  const onPatchApplied = useCallback(
    (filePath: string, from: number, to: number, insert: string, fullNewContent?: string) => {
      if (filePath !== activeFile) {
        openFile(filePath);
      }
      // Use CodeMirror precise replace to preserve undo
      dispatchEditorReplace(from, to, insert);
      // Also update local state / persist
      const next =
        fullNewContent && fullNewContent !== contentRef.current
          ? fullNewContent
          : contentRef.current.slice(0, from) + insert + contentRef.current.slice(to);
      setFileContent(next);
      void saveFile(next);
    },
    [activeFile, openFile, saveFile],
  );

  const jumpToDiagnostic = useCallback(
    (filePath: string, _line?: number) => {
      if (filePath) openFile(filePath);
    },
    [openFile],
  );

  if (status === "loading" && !desktopMode) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="workspace-shell flex h-screen flex-col text-ink">
      {/* Top bar */}
      <header
        data-tauri-drag-region
        className="workspace-topbar flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 pt-2"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={() => router.push("/")}
            className="rounded-md p-1.5 text-muted transition hover:bg-elevated hover:text-ink"
            title="返回项目列表"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-xs font-bold text-white shadow-sm">Y</div>
          <div className="min-w-0">
            {editingProjectName ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void renameCurrentProject();
                }}
              >
                <input
                  autoFocus
                  value={projectNameDraft}
                  onChange={(e) => setProjectNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingProjectName(false);
                  }}
                  className="w-44 rounded border border-accent bg-surface px-1.5 py-0.5 text-[13px] font-semibold outline-none"
                  aria-label="项目名称"
                />
                <button type="submit" disabled={savingProjectName || !projectNameDraft.trim()} className="rounded p-1 text-accent hover:bg-accent-soft disabled:opacity-40" title="保存项目名称">
                  <Check size={13} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setProjectNameDraft(projectName);
                  setEditingProjectName(true);
                }}
                className="group flex max-w-full items-center gap-1 text-left"
                title="重命名项目"
              >
                <h1 className="truncate text-[13px] font-semibold tracking-tight">{projectName || "Project"}</h1>
                <Pencil size={11} className="shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
              </button>
            )}
            <p className="truncate text-[10px] text-muted">{activeFile || "LaTeX research workspace"}</p>
          </div>
        </div>
        <label className="workspace-command mx-auto hidden min-w-[260px] max-w-[430px] flex-1 items-center gap-2 rounded-lg border border-border bg-elevated/70 px-3 py-2 text-muted transition focus-within:border-accent/50 md:flex">
          <Search size={14} />
          <input
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            placeholder="搜索文件、符号，或问 AI…"
            className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted">⌘K</kbd>
        </label>
        <div className="ml-auto flex items-center gap-1">
          {/* center mode */}
          <div className="mr-2 flex rounded-md border border-border">
            {(
              [
                ["editor", Code2],
                ["split", Columns2],
                ["preview", Eye],
              ] as const
            ).map(([mode, Icon]) => (
              <button
                key={mode}
                onClick={() => setCenterMode(mode)}
                className={cn(
                  "p-1.5",
                  centerMode === mode ? "bg-accent-soft text-accent" : "text-muted hover:text-ink",
                )}
                title={mode}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <div className="mr-1 flex items-center rounded-md border border-border" title="编辑器字号">
            <button
              onClick={() => setEditorFontSize(editorFontSize - 1)}
              className="p-1.5 text-muted hover:bg-elevated hover:text-ink"
              aria-label="缩小编辑器文字"
            >
              <Minus size={13} />
            </button>
            <span className="min-w-9 text-center text-2xs text-muted">{editorFontSize}px</span>
            <button
              onClick={() => setEditorFontSize(editorFontSize + 1)}
              className="p-1.5 text-muted hover:bg-elevated hover:text-ink"
              aria-label="放大编辑器文字"
            >
              <Plus size={13} />
            </button>
          </div>
          <button
            onClick={() => void saveFile(contentRef.current, versionId)}
            className="rounded-md p-1.5 text-muted hover:bg-elevated hover:text-ink"
            title="Save (⌘S)"
          >
            <Save size={14} />
          </button>
          <button
            onClick={() => void compile()}
            disabled={compiling}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            title="Compile (⌘↵)"
          >
            {compiling ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Compile
          </button>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-md p-1.5 text-muted hover:bg-elevated hover:text-ink"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      {/* Three panels */}
      <PanelGroup direction="horizontal" className="h-full min-h-0 flex-1 w-full">
        {/* Left: file tree */}
        {!leftCollapsed && (
          <>
            <Panel defaultSize={18} minSize={12} maxSize={30} className="border-r border-border">
              <FileTree
                tree={tree}
                query={fileSearch}
                onRefresh={() => void loadTree()}
                onCollapse={() => setLeftCollapsed(true)}
              />
            </Panel>
            <PanelResizeHandle className="group relative w-2 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/20">
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-accent" />
            </PanelResizeHandle>
          </>
        )}
        {leftCollapsed && (
          <button
            onClick={() => setLeftCollapsed(false)}
            className="flex w-8 shrink-0 items-center justify-center border-r border-border text-muted hover:text-accent"
            title="Show files"
          >
            <ChevronLeft size={14} className="rotate-180" />
          </button>
        )}

        {/* Center: editor + preview */}
        <Panel defaultSize={52} minSize={30}>
          <div className="flex h-full flex-col">
            {/* Tabs */}
            {openFiles.length > 0 && (
              <div className="flex shrink-0 items-center gap-1 border-b border-border bg-elevated/55 px-2 pt-2">
                {openFiles.map((f) => (
                  <div
                    key={f}
                    className={cn(
                      "group flex items-center gap-1 rounded-t-md px-3 py-1.5 text-2xs transition",
                      activeFile === f
                        ? "border border-b-0 border-border bg-surface font-medium text-ink"
                        : "text-muted hover:bg-surface/60 hover:text-ink",
                    )}
                  >
                    <button onClick={() => openFile(f)} className="max-w-[140px] truncate font-mono">
                      {f.split("/").pop()}
                    </button>
                    <button
                      onClick={() => closeFile(f)}
                      className="opacity-0 group-hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex min-h-0 flex-1">
              <PanelGroup
                key={centerMode}
                direction="horizontal"
                className="h-full min-h-0 w-full"
                autoSaveId={`yiyabo-center-${centerMode}`}
              >
              {(centerMode === "split" || centerMode === "editor") && (
                <>
                <Panel defaultSize={50} minSize={20}>
                  {activeFile && !loadingFile ? (
                    <LatexEditor
                      projectId={projectId}
                      filePath={activeFile}
                      value={fileContent}
                      onChange={setFileContent}
                      onSave={(v) => void saveFile(v, versionId)}
                      fontSize={editorFontSize}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted">
                      {loadingFile ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        "Select a file to edit"
                      )}
                    </div>
                  )}
                </Panel>
                {centerMode === "split" && (
                  <PanelResizeHandle className="group relative w-2 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/20">
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-accent" />
            </PanelResizeHandle>
                )}
                </>
              )}
              {(centerMode === "split" || centerMode === "preview") && (
                <Panel defaultSize={50} minSize={20}>
                  <PdfPreview url={pdfUrl} />
                </Panel>
              )}
              </PanelGroup>
            </div>

            <CompileStatusBar
              status={compileStatus}
              onJump={jumpToDiagnostic}
              onAiFix={requestAiFix}
            />
          </div>
        </Panel>

        {!rightCollapsed && (
          <>
            <PanelResizeHandle className="group relative w-2 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/20">
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-accent" />
            </PanelResizeHandle>
            <Panel defaultSize={30} minSize={20} maxSize={40}>
              <div className="h-full">
                <AiPanel
                  projectId={projectId}
                  aiFixRequest={aiFixRequest}
                  onPatchApplied={onPatchApplied}
                  onCollapse={() => setRightCollapsed(true)}
                />
              </div>
            </Panel>
          </>
        )}
        {rightCollapsed && (
          <button
            onClick={() => setRightCollapsed(false)}
            className="flex w-8 shrink-0 items-center justify-center border-l border-border text-muted hover:text-accent"
            title="Show AI panel"
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </PanelGroup>

      <Toast />
      {/* selection debug in title for QA */}
      <span className="sr-only">{selection?.selectedText?.slice(0, 20)}</span>
    </div>
  );
}
