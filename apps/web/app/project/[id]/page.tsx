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
  ChevronLeft,
  Code2,
  Columns2,
  Eye,
  Loader2,
  Minus,
  Moon,
  Play,
  Plus,
  Save,
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
  const [projectName, setProjectName] = useState("");
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
      if (mod && e.key === "Enter") {
        e.preventDefault();
        void compile();
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Ask the assistant…"]');
        el?.focus();
      }
      if (e.key === "Escape") {
        // clear selection display focus
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [compile]);

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
    <div className="flex h-screen flex-col bg-bg text-ink">
      {/* Top bar */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/")} className="text-muted hover:text-ink">
            <ChevronLeft size={16} />
          </button>
          <h1 className="text-sm font-medium">{projectName || "Project"}</h1>
          {activeFile && (
            <span className="text-2xs text-muted font-mono">{activeFile}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
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
              <div className="flex shrink-0 items-center border-b border-border bg-elevated/40">
                {openFiles.map((f) => (
                  <div
                    key={f}
                    className={cn(
                      "group flex items-center gap-1 border-r border-border px-3 py-1.5 text-2xs",
                      activeFile === f
                        ? "bg-surface text-ink"
                        : "text-muted hover:text-ink",
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

            <CompileStatusBar status={compileStatus} onJump={jumpToDiagnostic} />
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
