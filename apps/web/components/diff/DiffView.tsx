"use client";

import { useMemo, useState } from "react";
import type { PatchProposal } from "@latex-ide/contracts";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

/** Minimal word-level diff for preview */
function diffWords(oldText: string, newText: string) {
  const a = oldText.split(/(\s+)/);
  const b = newText.split(/(\s+)/);
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const parts: Array<{ type: "eq" | "del" | "add"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      parts.push({ type: "eq", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      parts.push({ type: "del", text: a[i]! });
      i++;
    } else {
      parts.push({ type: "add", text: b[j]! });
      j++;
    }
  }
  while (i < m) parts.push({ type: "del", text: a[i++]! });
  while (j < n) parts.push({ type: "add", text: b[j++]! });
  return parts;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  applied: "已应用",
  rejected: "已拒绝",
  conflict: "有冲突",
  accepted: "已接受",
};

const STATUS_TONE: Record<string, string> = {
  pending: "text-accent",
  applied: "text-success",
  rejected: "text-muted",
  conflict: "text-warn",
  accepted: "text-success",
};

export function DiffView({
  proposal,
  onAccept,
  onReject,
  busy,
  compact = false,
}: {
  proposal: PatchProposal;
  onAccept?: () => void;
  onReject?: () => void;
  busy?: boolean;
  /** Compact history card: collapsed by default, no accept/reject */
  compact?: boolean;
}) {
  const op = proposal.operations[0];
  const [open, setOpen] = useState(!compact);
  const parts = useMemo(() => {
    if (!op) return [];
    return diffWords(op.expectedOldText, op.newText);
  }, [op]);

  if (!op) return null;

  const delta = op.newText.length - op.expectedOldText.length;

  // Compact history row
  if (compact) {
    return (
      <div className="rounded-md border border-border bg-elevated/40">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          {open ? (
            <ChevronDown size={12} className="shrink-0 text-muted" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted" />
          )}
          <span className="min-w-0 flex-1 truncate text-2xs">{proposal.summary}</span>
          <span className={cn("shrink-0 text-2xs font-medium", STATUS_TONE[proposal.status] || "text-muted")}>
            {STATUS_LABEL[proposal.status] || proposal.status}
          </span>
        </button>
        {open && (
          <div className="border-t border-border">
            <div className="px-2.5 py-1 text-2xs text-muted">
              {op.filePath} · {delta >= 0 ? "+" : ""}
              {delta} chars
            </div>
            <div className="thin-scroll max-h-40 overflow-y-auto px-2.5 pb-2 font-mono text-2xs leading-relaxed">
              {parts.map((p, i) =>
                p.type === "eq" ? (
                  <span key={i}>{p.text}</span>
                ) : p.type === "del" ? (
                  <span key={i} className="diff-del rounded px-0.5 text-danger">
                    {p.text}
                  </span>
                ) : (
                  <span key={i} className="diff-add rounded px-0.5 text-success">
                    {p.text}
                  </span>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Interactive pending card
  return (
    <div className="rounded-lg border border-border bg-elevated/60">
      <div className="border-b border-border px-3 py-2">
        <div className="text-xs font-medium">{proposal.summary}</div>
        <div className="mt-0.5 text-2xs text-muted">
          {op.filePath} · {delta >= 0 ? "+" : ""}
          {delta} chars
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed">
        {parts.map((p, i) =>
          p.type === "eq" ? (
            <span key={i}>{p.text}</span>
          ) : p.type === "del" ? (
            <span key={i} className="diff-del rounded px-0.5 text-danger">
              {p.text}
            </span>
          ) : (
            <span key={i} className="diff-add rounded px-0.5 text-success">
              {p.text}
            </span>
          ),
        )}
      </div>
      {(proposal.status === "pending" || proposal.status === "conflict") && onAccept && onReject && (
        <div className="flex gap-2 border-t border-border px-3 py-2">
          <button
            onClick={onAccept}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {proposal.status === "conflict" ? "重新应用" : "Accept"}
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1 text-xs hover:bg-surface disabled:opacity-50"
          >
            Reject
          </button>
          {proposal.status === "conflict" && (
            <span className="self-center text-2xs text-warn">文档已变化</span>
          )}
        </div>
      )}
      {proposal.status !== "pending" && proposal.status !== "conflict" && (
        <div className="border-t border-border px-3 py-2 text-2xs text-muted">
          状态：
          <span className={cn("font-medium", STATUS_TONE[proposal.status])}>
            {STATUS_LABEL[proposal.status] || proposal.status}
          </span>
        </div>
      )}
    </div>
  );
}
