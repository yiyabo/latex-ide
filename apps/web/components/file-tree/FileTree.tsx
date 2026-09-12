"use client";

import { useCallback, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { FileTreeNode } from "@latex-ide/contracts";
import { useWorkbench } from "@/lib/stores/workbench";
import { cn } from "@/lib/utils";

export function FileTree({
  tree,
  onRefresh,
  onOpenFile,
  onCollapse,
}: {
  tree: FileTreeNode[];
  onRefresh?: () => void;
  onOpenFile?: (path: string) => void;
  onCollapse?: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      // Keep the spin visible for at least one beat so the click feels acknowledged
      setTimeout(() => setRefreshing(false), 400);
    }
  }, [onRefresh, refreshing]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="rounded p-0.5 text-muted hover:bg-elevated hover:text-ink"
              title="收起文件栏"
            >
              <ChevronLeft size={13} />
            </button>
          )}
          <span className="truncate text-2xs font-semibold uppercase tracking-wider text-muted">
            Files
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onRefresh && (
            <button
              onClick={() => void handleRefresh()}
              className="rounded p-1 text-muted hover:bg-elevated hover:text-ink disabled:opacity-50"
              title="刷新文件列表"
              disabled={refreshing}
            >
              <RefreshCw
                size={13}
                className={cn(refreshing && "animate-spin")}
              />
            </button>
          )}
        </div>
      </div>
      <div className="thin-scroll flex-1 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeNode key={node.path} node={node} depth={0} onOpenFile={onOpenFile} />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  onOpenFile,
}: {
  node: FileTreeNode;
  depth: number;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const { activeFile, openFile } = useWorkbench();
  const isActive = activeFile === node.path;

  const handleClick = useCallback(() => {
    if (node.type === "directory") {
      setOpen((o) => !o);
    } else {
      openFile(node.path);
      onOpenFile?.(node.path);
    }
  }, [node, openFile, onOpenFile]);

  return (
    <>
      <button
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[13px] hover:bg-elevated",
          isActive && "bg-accent-soft text-accent",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {node.type === "directory" ? (
          <>
            {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
            {open ? (
              <FolderOpen size={13} className="shrink-0 text-muted" />
            ) : (
              <Folder size={13} className="shrink-0 text-muted" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileText size={13} className="shrink-0 text-muted" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.type === "directory" &&
        open &&
        node.children?.map((c) => (
          <TreeNode key={c.path} node={c} depth={depth + 1} onOpenFile={onOpenFile} />
        ))}
    </>
  );
}
