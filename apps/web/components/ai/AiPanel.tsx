"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  FileText,
  History,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import {
  QUICK_ACTION_LABELS,
  type PatchProposal,
  type QuickAction,
} from "@latex-ide/contracts";
import { useWorkbench, type ChatItem, type ConversationMeta, type PatchItem } from "@/lib/stores/workbench";
import { DiffView } from "@/components/diff/DiffView";
import { AiSettings } from "@/components/ai/AiSettings";
import { Markdown } from "@/components/ui/Markdown";
import { cn } from "@/lib/utils";

const ACTIONS = Object.entries(QUICK_ACTION_LABELS) as Array<[QuickAction, string]>;

type LoadedConversation = {
  id: string;
  title: string;
  createdAt?: string;
  messages: Array<{ id: string; role: string; content: string; createdAt?: string }>;
  patches: Array<{
    id: string;
    summary: string;
    operations: PatchProposal["operations"];
    baseVersionId: string;
    status: PatchProposal["status"];
    messageId?: string | null;
    createdAt?: string;
  }>;
};

/** One line in the agent activity card (tool call / status / result). */
type ActivityItem = {
  id: string;
  kind: "tool" | "info" | "text";
  label: string;
  detail?: string;
  state: "running" | "succeeded" | "failed";
  /** epoch ms when this item started — used to show live elapsed time */
  startedAt?: number;
  /** epoch ms snapshot when the item finished — freezes its displayed duration */
  finishedAt?: number;
};

function toMeta(c: LoadedConversation, updatedAt?: string): ConversationMeta {
  return {
    id: c.id,
    title: c.title || "Untitled",
    messageCount: c.messages.length,
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

export function AiPanel({
  projectId,
  onPatchApplied,
  onCollapse,
}: {
  projectId: string;
  onPatchApplied?: (filePath: string, from: number, to: number, insert: string, newText: string) => void;
  onCollapse?: () => void;
}) {
  const {
    selection,
    chat,
    appendChat,
    conversationId,
    setConversationId,
    conversations,
    setConversations,
    pendingPatches,
    addPatch,
    updatePatch,
    clearPatches,
    setChat,
    showToast,
  } = useWorkbench();

  const [input, setInput] = useState("");
  const composingInput = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const [streamBuf, setStreamBuf] = useState("");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<LoadedConversation[]>([]);
  const listWrapRef = useRef<HTMLDivElement>(null);

  const applyConversation = useCallback(
    (conv: LoadedConversation) => {
      setConversationId(conv.id);
      const items: ChatItem[] = conv.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.role === "user" ? displayUserContent(m.content) : m.content,
          createdAt: m.createdAt,
        }));
      setChat(items);
      clearPatches();
      // Keep full patch history, including messageId for inline timeline
      for (const p of conv.patches || []) {
        addPatch({
          id: p.id,
          conversationId: conv.id,
          summary: p.summary,
          operations: p.operations as PatchProposal["operations"],
          baseVersionId: p.baseVersionId,
          status: p.status,
          messageId: p.messageId ?? null,
          createdAt: p.createdAt,
        });
      }
    },
    [setConversationId, setChat, clearPatches, addPatch],
  );

  // Load conversation list + restore active (or latest)
  useEffect(() => {
    let cancelled = false;

    // Project switch: wipe local chat state immediately so the previous
    // project's conversation never flashes/appears while loading this one's.
    setConversationId(null);
    setChat([]);
    clearPatches();
    setStreamBuf("");
    setActivity([]);

    (async () => {
      try {
        const res = await fetch(`/api/ai/chat?projectId=${encodeURIComponent(projectId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const convs = (data.conversations || []) as LoadedConversation[];
        if (cancelled) return;

        conversationsRef.current = convs;
        setConversations(
          convs.map((c) =>
            toMeta(c, (c as { createdAt?: string }).createdAt),
          ),
        );

        if (convs.length === 0) return;

        // Restore this project's most recent conversation. NOTE: conversationId
        // is intentionally NOT read from persisted state here — it is
        // project-scoped and must never leak across projects.
        const preferred = convs[0]!;
        if (!cancelled) applyConversation(preferred);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, setConversations, applyConversation, setConversationId, setChat, clearPatches]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!listOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!listWrapRef.current?.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [listOpen]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length, streamBuf, activity.length, pendingPatches.length]);

  const startNewChat = useCallback(() => {
    setListOpen(false);
    if (streaming) return;
    setConversationId(null);
    setChat([]);
    clearPatches();
    setStreamBuf("");
    setActivity([]);
    showToast("已开始新对话");
  }, [setConversationId, setChat, clearPatches, streaming, showToast]);

  const switchConversation = useCallback(
    async (id: string) => {
      if (id === conversationId || streaming) return;
      setListOpen(false);
      setLoadingConv(true);
      try {
        // Prefer in-memory cache
        let conv = conversationsRef.current.find((c) => c.id === id);
        if (!conv) {
          const res = await fetch(`/api/ai/chat?projectId=${encodeURIComponent(projectId)}`);
          const data = await res.json();
          conversationsRef.current = data.conversations || [];
          conv = conversationsRef.current.find((c) => c.id === id);
        }
        if (conv) applyConversation(conv);
      } catch {
        showToast("加载对话失败");
      } finally {
        setLoadingConv(false);
      }
    },
    [conversationId, streaming, projectId, applyConversation, showToast],
  );

  const send = useCallback(
    async (message: string, action?: string) => {
      if (!message.trim() && !action) return;
      appendChat({
        id: `u-${Date.now()}`,
        role: "user",
        content: action ? QUICK_ACTION_LABELS[action as QuickAction] || message : message,
      });
      setInput("");
      setStreaming(true);
      setStreamBuf("");
      setActivity([{ id: "req", kind: "info", label: "已发送请求，等待模型响应…", state: "succeeded" }]);
      setThinkingOpen(true);

      const pushStep = (_s: string) => {
        /* legacy no-op — activity card replaced step list */
      };

      const upsertActivity = (
        id: string,
        kind: ActivityItem["kind"],
        label: string,
        detail?: string,
        state: ActivityItem["state"] = "running",
      ) =>
        setActivity((prev) => [
          ...prev,
          {
            id,
            kind,
            label,
            detail,
            state,
            startedAt: Date.now(),
            // Instant-completion entries (status/info) freeze their duration now;
            // running entries get finishedAt stamped when they transition later.
            finishedAt: state === "running" ? undefined : Date.now(),
          },
        ]);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            message: message || action || "",
            ...(action ? { action } : {}),
            ...(conversationId ? { conversationId } : {}),
            ...(selection ? { selection } : {}),
          }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          appendChat({ id: `e-${Date.now()}`, role: "system", content: err.error || "AI request failed" });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let acc = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split("\n\n");
          buf = chunks.pop() || "";
          for (const chunk of chunks) {
            const line = chunk.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.type === "token") {
                if (!acc) {
                  // New generation round: finish any earlier still-running entries
                  setActivity((prev) =>
                    prev.map((a) =>
                      a.state === "running" && a.kind === "text"
                        ? { ...a, state: "succeeded" as const, finishedAt: Date.now() }
                        : a,
                    ),
                  );
                  upsertActivity("gen", "text", "生成回复中…", undefined, "running");
                }
                acc += ev.content;
                setStreamBuf(acc);
              } else if (ev.type === "status") {
                // A status line means the model moved on (e.g. calling tools) —
                // any previous "生成回复中" entry is now finished.
                setActivity((prev) =>
                  prev.map((a) =>
                    a.kind === "text" && a.state === "running"
                      ? { ...a, state: "succeeded" as const, finishedAt: Date.now() }
                      : a,
                  ),
                );
                upsertActivity(`st-${Date.now()}-${Math.random()}`, "info", String(ev.message || ""), undefined, "succeeded");
              } else if (ev.type === "tool_call") {
                const name = String(ev.name || "");
                if (name.endsWith(":result")) {
                  // Complete the matching "running" tool entry
                  const toolName = name.slice(0, -":result".length);
                  const preview = String((ev.args as { preview?: string })?.preview || "");
                  setActivity((prev) => {
                    const idx = [...prev]
                      .map((a, i) => ({ a, i }))
                      .reverse()
                      .find(({ a }) => a.kind === "tool" && a.label === toolLabel(toolName) && a.state === "running")?.i;
                    if (idx === undefined) return prev;
                    const next = [...prev];
                    next[idx] = {
                      ...next[idx]!,
                      state: "succeeded" as const,
                      finishedAt: Date.now(),
                      detail: preview || next[idx]!.detail,
                    };
                    return next;
                  });
                } else {
                  upsertActivity(`tc-${Date.now()}-${Math.random()}`, "tool", toolLabel(name), undefined, "running");
                }
              } else if (ev.type === "patch_proposal") {
                const proposal = ev.proposal as PatchProposal;
                if (proposal.conversationId) {
                  setConversationId(proposal.conversationId);
                }
                addPatch(proposal);
                upsertActivity(`pp-${Date.now()}`, "info", "已生成修改建议，请在下方查看 diff", undefined, "succeeded");
              } else if (ev.type === "done") {
                const msgId = String(ev.messageId || "");
                if (ev.conversationId) {
                  setConversationId(ev.conversationId);
                  void fetch(`/api/ai/chat?projectId=${encodeURIComponent(projectId)}`)
                    .then((r) => r.json())
                    .then((d) => {
                      const convs = (d.conversations || []) as LoadedConversation[];
                      conversationsRef.current = convs;
                      setConversations(convs.map((c) => toMeta(c)));
                    })
                    .catch(() => {});
                }
                // Attach any just-created patches to this assistant message
                if (msgId) {
                  const st = useWorkbench.getState();
                  for (const p of st.pendingPatches) {
                    if (!p.messageId && p.status === "pending") {
                      st.linkPatchToMessage(p.id, msgId);
                    }
                  }
                }
              } else if (ev.type === "error") {
                appendChat({ id: `e-${Date.now()}`, role: "system", content: ev.message });
              }
            } catch {
              /* ignore */
            }
          }
        }

        if (acc) {
          appendChat({ id: `a-${Date.now()}`, role: "assistant", content: acc });
        }
      } catch (e) {
        appendChat({
          id: `e-${Date.now()}`,
          role: "system",
          content: e instanceof Error ? e.message : "Network error",
        });
      } finally {
        setStreaming(false);
        setStreamBuf("");
        // Mark any still-running entries as finished (e.g. stream ended early)
        setActivity((prev) =>
          prev.map((a) =>
            a.state === "running"
              ? { ...a, state: "succeeded" as const, finishedAt: Date.now() }
              : a,
          ),
        );
        // Keep steps visible briefly so user can expand, then auto-collapse
        setTimeout(() => setThinkingOpen(false), 1200);
      }
    },
    [
      projectId,
      conversationId,
      selection,
      appendChat,
      addPatch,
      setConversationId,
      setConversations,
    ],
  );

  const acceptPatch = useCallback(
    async (patch: PatchProposal) => {
      try {
        const res = await fetch(`/api/ai/patches/${patch.id}/accept`, { method: "POST" });
        const data = await res.json();
        if (res.status === 409) {
          updatePatch(patch.id, "conflict");
          showToast("Conflict — document changed");
          return;
        }
        if (!res.ok) {
          showToast(data.error || "Failed to accept");
          return;
        }
        updatePatch(patch.id, "applied");
        const op = patch.operations[0];
        if (op) {
          onPatchApplied?.(op.filePath, op.start, op.end, op.newText, data.content ?? op.newText);
        }
        showToast("Patch applied");
      } catch {
        showToast("Failed to accept patch");
      }
    },
    [updatePatch, showToast, onPatchApplied],
  );

  const rejectPatch = useCallback(
    async (patch: PatchProposal) => {
      await fetch(`/api/ai/patches/${patch.id}/reject`, { method: "POST" }).catch(() => {});
      updatePatch(patch.id, "rejected");
      showToast("Patch rejected");
    },
    [updatePatch, showToast],
  );

  const activeTitle =
    conversations.find((c) => c.id === conversationId)?.title ||
    (conversationId ? "当前对话" : "新对话");

  // Interactive patches for the active conversation
  const convPatches = pendingPatches.filter((p) => {
    if (!conversationId) return false;
    if (p.conversationId && p.conversationId !== conversationId) return false;
    return true;
  });

  const patchByMessageId = new Map<string, PatchItem>();
  for (const p of convPatches) {
    if (p.messageId) patchByMessageId.set(p.messageId, p);
  }

  // Patches not yet linked to a message (live stream) → footer
  const unlinkedPatches = convPatches.filter((p) => !p.messageId);
  const livePending = unlinkedPatches.filter(
    (p) => p.status === "pending" || p.status === "conflict",
  );
  const liveHistory = unlinkedPatches.filter(
    (p) => p.status === "applied" || p.status === "rejected" || p.status === "accepted",
  );

  const renderPatch = (p: PatchItem) => {
    if (p.status === "pending" || p.status === "conflict") {
      return (
        <DiffView
          key={p.id}
          proposal={p}
          onAccept={() => acceptPatch(p)}
          onReject={() => rejectPatch(p)}
          busy={streaming}
        />
      );
    }
    return <DiffView key={p.id} proposal={p} compact />;
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles size={12} className="shrink-0 text-accent" />
          <span className="truncate text-2xs font-semibold uppercase tracking-wider text-muted">
            AI Assistant
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Conversation switcher */}
          <div ref={listWrapRef} className="relative">
            <button
              onClick={() => setListOpen((o) => !o)}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-2xs text-muted hover:bg-elevated hover:text-ink"
              title="切换对话"
            >
              <History size={12} />
              <span className="hidden max-w-[90px] truncate sm:inline">{activeTitle}</span>
            </button>
            {listOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
                  <span className="text-2xs font-medium text-muted">对话历史</span>
                  <button
                    onClick={startNewChat}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs text-accent hover:bg-accent-soft"
                  >
                    <Plus size={11} /> 新建
                  </button>
                </div>
                <ul className="thin-scroll max-h-56 overflow-y-auto py-1">
                  {conversations.length === 0 && (
                    <li className="px-3 py-2 text-2xs text-muted">暂无历史对话</li>
                  )}
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => void switchConversation(c.id)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-elevated",
                          c.id === conversationId && "bg-accent-soft",
                        )}
                      >
                        <span className="truncate text-xs">{c.title || "Untitled"}</span>
                        <span className="text-2xs text-muted">
                          {c.messageCount} 条消息
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <button
            onClick={startNewChat}
            disabled={streaming}
            className="rounded p-1 text-muted hover:bg-elevated hover:text-ink disabled:opacity-40"
            title="新建对话"
          >
            <Plus size={13} />
          </button>
          <AiSettings />
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="rounded p-1 text-muted hover:bg-elevated hover:text-ink"
              title="Collapse AI panel"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {loadingConv && (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1 text-2xs text-muted">
          <Loader2 size={11} className="animate-spin" /> 加载对话…
        </div>
      )}

      {/* Selection context card */}
      <div className="border-b border-border px-3 py-2">
        {selection ? (
          <SelectionCard selection={selection} />
        ) : (
          <p className="text-2xs text-muted">No selection — select text in the editor to give context.</p>
        )}
      </div>

      {/* Chat */}
      <div ref={listRef} className="thin-scroll flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {chat.length === 0 && !streaming && (
          <p className="text-2xs leading-relaxed text-muted">
            {conversations.length === 0
              ? "Select a passage, then choose a quick action or type a request. Suggestions appear as diffs you can accept or reject."
              : "这是一条新对话。选中编辑器文本，或直接输入问题。"}
          </p>
        )}
        {chat.map((m) => {
          const linked = m.role === "assistant" ? patchByMessageId.get(m.id) : undefined;
          return (
            <div key={m.id} className="space-y-2">
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "ml-6 bg-accent-soft"
                    : m.role === "system"
                      ? "bg-danger/10 text-danger"
                      : "bg-elevated",
                )}
              >
                {m.role === "user" || m.role === "system" ? (
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                ) : (
                  <Markdown text={m.content} />
                )}
              </div>
              {/* Inline patch under the assistant message that proposed it */}
              {linked && <div className="ml-1">{renderPatch(linked)}</div>}
            </div>
          );
        })}
        {streaming && streamBuf && (
          <div className="rounded-lg bg-elevated px-3 py-2 text-[13px] leading-relaxed">
            <Markdown text={streamBuf} />
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent align-middle" />
          </div>
        )}
        {streaming && !streamBuf && (
          <div className="flex items-center gap-2 text-2xs text-muted">
            <Loader2 size={12} className="animate-spin" /> thinking…
          </div>
        )}

        {/* Agent activity — visible during streaming AND kept after completion
            (collapsed to a one-line summary) until the next message is sent. */}
        {activity.length > 0 && (
          <ActivityCard
            items={activity}
            open={thinkingOpen}
            onToggle={() => setThinkingOpen((o) => !o)}
            expandedId={expandedActivityId}
            onExpandItem={(id) =>
              setExpandedActivityId((cur) => (cur === id ? null : id))
            }
          />
        )}

        {/* Live patches not yet linked to a saved message */}
        {livePending.length > 0 && (
          <div className="space-y-2 pt-1">{livePending.map(renderPatch)}</div>
        )}

        {liveHistory.length > 0 && (
          <div className="pt-1">
            <div className="mb-1 flex items-center gap-1 text-2xs font-medium text-muted">
              <History size={11} />
              修改记录（{liveHistory.length}）
            </div>
            <div className="space-y-1.5">{liveHistory.map(renderPatch)}</div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-1 border-t border-border px-2 py-2">
        {ACTIONS.map(([key, label]) => (
          <button
            key={key}
            disabled={!selection || streaming}
            onClick={() => send("", key)}
            className="rounded-full border border-border px-2.5 py-1 text-2xs hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (composingInput.current) return;
            void send(input);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="relative z-10 flex items-end gap-2"
        >
          <textarea
            id="ai-assistant-input"
            name="message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => {
              composingInput.current = true;
            }}
            onCompositionEnd={() => {
              composingInput.current = false;
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              const native = e.nativeEvent as KeyboardEvent;
              const composing = composingInput.current || native.isComposing || e.keyCode === 229;
              if (e.key === "Enter" && !e.shiftKey && !composing) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="输入问题或指令…"
            aria-label="输入问题或指令"
            autoComplete="off"
            spellCheck={false}
            rows={2}
            className="thin-scroll relative z-10 flex-1 resize-none rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-md bg-accent p-2 text-white disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}

function SelectionCard({
  selection,
}: {
  selection: {
    filePath: string;
    cursorLine: number;
    selectedText: string;
    sectionPath: string[];
  };
}) {
  const [open, setOpen] = useState(true);
  const preview =
    selection.selectedText.length > 120
      ? selection.selectedText.slice(0, 120) + "…"
      : selection.selectedText;

  return (
    <div className="rounded-md border border-border bg-elevated/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <FileText size={12} className="shrink-0 text-accent" />
        <span className="truncate text-2xs font-medium">
          {selection.filePath}:{selection.cursorLine}
        </span>
        {selection.sectionPath.length > 0 && (
          <span className="truncate text-2xs text-muted">
            {selection.sectionPath.join(" › ")}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-2 py-1.5 text-2xs leading-relaxed text-muted">
          {preview}
        </div>
      )}
    </div>
  );
}

/** Strip server-side context blocks so history shows the user's actual question */
function displayUserContent(raw: string): string {
  let t = raw;
  const idx = t.indexOf("FILE: ");
  if (idx > 0) t = t.slice(0, idx).trim();
  // Drop the long action instruction prefix if present
  t = t
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .join(" ")
    .replace(/^(Polish|Expand|Condense|Fix any|Rewrite)[^.]*\.\s*/i, "")
    .trim();
  if (!t) return "（快捷操作）";
  return t.length > 200 ? t.slice(0, 200) + "…" : t;
}


function toolLabel(name: string): string {
  const map: Record<string, string> = {
    read_file_range: "读取文件片段",
    get_compile_errors: "读取编译错误",
    read_selection: "读取选区",
    propose_patch: "生成修改建议",
    search_project: "检索项目",
  };
  return map[name.replace(/:result$/, "")] || name;
}

function ActivityCard({
  items,
  open,
  onToggle,
  expandedId,
  onExpandItem,
}: {
  items: ActivityItem[];
  open: boolean;
  onToggle: () => void;
  expandedId: string | null;
  onExpandItem: (id: string) => void;
}) {
  // Tick every second while any item is running, so live elapsed times update.
  const hasRunning = items.some((a) => a.state === "running");
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [hasRunning]);

  const runningCount = items.filter((a) => a.state === "running").length;
  const toolsDone = items.filter((a) => a.kind === "tool" && a.state === "succeeded").length;
  const isBusy = runningCount > 0;
  const header = isBusy
    ? items[items.length - 1]?.label || "思考中…"
    : `已完成${toolsDone > 0 ? ` ${toolsDone} 次工具调用` : ""}`;

  const elapsed = (a: ActivityItem): string => {
    if (!a.startedAt) return "";
    // Freeze the duration when the item completes: use startedAt + a stored
    // finishedAt snapshot instead of recomputing against Date.now(), which
    // previously made finished entries' times keep ticking up.
    const end = a.state === "running" ? Date.now() : (a.finishedAt ?? Date.now());
    const s = Math.max(0, Math.round((end - a.startedAt) / 1000));
    if (a.state === "running") return s >= 1 ? ` ${s}s` : "";
    return s >= 3 ? ` ${s}s` : "";
  };

  return (
    <div className="rounded-lg border border-border bg-accent-soft/40">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        {isBusy ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
        ) : (
          <CheckCircle2 size={12} className="shrink-0 text-success" />
        )}
        <span className="min-w-0 flex-1 truncate text-2xs text-ink">{header}</span>
        {open ? (
          <ChevronDown size={12} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-muted" />
        )}
      </button>
      {open && items.length > 0 && (
        <ul className="space-y-0.5 border-t border-border px-3 py-1.5">
          {items.map((a) => (
            <li key={a.id} className="text-2xs">
              <button
                onClick={() => a.detail && onExpandItem(a.id)}
                className={`flex w-full items-start gap-1.5 rounded px-0.5 py-0.5 text-left ${
                  a.detail ? "cursor-pointer hover:bg-elevated" : "cursor-default"
                }`}
              >
                {a.state === "running" ? (
                  <Loader2 size={10} className="mt-1 shrink-0 animate-spin text-accent" />
                ) : a.kind === "tool" ? (
                  <Wrench size={10} className="mt-1 shrink-0 text-muted" />
                ) : (
                  <span
                    className={`mt-1 h-1 w-1 shrink-0 rounded-full ${
                      a.state === "failed" ? "bg-danger" : "bg-accent/60"
                    }`}
                  />
                )}
                <span
                  className={
                    a.state === "running"
                      ? "text-ink"
                      : a.kind === "tool"
                        ? "text-muted"
                        : "text-muted"
                  }
                >
                  {a.label}
                  {a.state === "succeeded" && a.kind === "tool" ? " ✓" : ""}
                  {elapsed(a) && (
                    <span className="ml-1 font-mono text-[10px] opacity-70">
                      {elapsed(a)}
                    </span>
                  )}
                  {a.state === "running" &&
                    a.startedAt &&
                    Date.now() - a.startedAt > 15_000 && (
                      <span className="ml-1 text-[10px] text-muted/80">
                        · 仍在执行，非卡住
                      </span>
                    )}
                </span>
              </button>
              {a.detail && expandedId === a.id && (
                <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-elevated px-2 py-1 font-mono text-[10px] leading-snug text-muted">
                  {a.detail}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
