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
  query = "",
}: {
  tree: FileTreeNode[];
  onRefresh?: () => void;
  onOpenFile?: (path: string) => void;
  onCollapse?: () => void;
  query?: string;
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
  const needle = query.trim().toLowerCase();
  const visibleTree = needle ? filterTree(tree, needle) : tree;

  return (
    <div className="workspace-panel flex h-full flex-col">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="rounded-md p-1 text-muted transition hover:bg-elevated hover:text-ink"
              title="收起文件栏"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Workspace</p>
            <p className="mt-0.5 text-xs font-semibold text-ink">项目文件</p>
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={() => void handleRefresh()}
            className="rounded-md p-1.5 text-muted transition hover:bg-elevated hover:text-ink disabled:opacity-50"
            title="刷新文件列表"
            disabled={refreshing}
          >
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          </button>
        )}
      </div>
      <div className="mx-3.5 border-t border-border" />
      <div className="thin-scroll flex-1 overflow-y-auto px-2.5 py-2.5">
        {visibleTree.length > 0 ? visibleTree.map((node) => (
          <TreeNode key={node.path} node={node} depth={0} onOpenFile={onOpenFile} />
        )) : (
          <p className="px-2 py-5 text-center text-xs text-muted">没有匹配的文件</p>
        )}
      </div>
    </div>
  );
}

function filterTree(nodes: FileTreeNode[], needle: string): FileTreeNode[] {
  return nodes.flatMap((node) => {
    const children = node.children ? filterTree(node.children, needle) : undefined;
    const selfMatches = node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle);
    if (node.type === "directory") {
      return selfMatches || (children && children.length > 0)
        ? [{ ...node, children: selfMatches ? node.children : children }]
        : [];
    }
    return selfMatches ? [node] : [];
  });
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
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition hover:bg-elevated",
          isActive && "bg-accent-soft font-medium text-accent",
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
