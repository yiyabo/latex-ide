"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CompileResult,
  EditorSelectionContext,
  PatchProposal,
} from "@latex-ide/contracts";

export type CenterMode = "split" | "editor" | "preview";
export type ChatItem = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  patchProposalId?: string;
  createdAt?: string;
};

/** Patch with optional message linkage for inline timeline rendering */
export type PatchItem = PatchProposal & {
  messageId?: string | null;
  createdAt?: string;
};

export type ConversationMeta = {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
};

type WorkbenchState = {
  theme: "light" | "dark";
  centerMode: CenterMode;
  editorFontSize: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  activeFile: string | null;
  openFiles: string[];
  selection: EditorSelectionContext | null;
  compileStatus: CompileResult | null;
  compiling: boolean;
  pendingPatches: PatchItem[];
  chat: ChatItem[];
  conversationId: string | null;
  conversations: ConversationMeta[];
  saveState: "saved" | "saving" | "dirty" | "error";
  toast: string | null;

  setTheme: (t: "light" | "dark") => void;
  setCenterMode: (m: CenterMode) => void;
  setEditorFontSize: (size: number) => void;
  setLeftCollapsed: (v: boolean) => void;
  setRightCollapsed: (v: boolean) => void;
  setActiveFile: (path: string | null) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setSelection: (s: EditorSelectionContext | null) => void;
  setCompileStatus: (r: CompileResult | null) => void;
  setCompiling: (v: boolean) => void;
  addPatch: (p: PatchItem) => void;
  updatePatch: (id: string, status: PatchProposal["status"]) => void;
  linkPatchToMessage: (patchId: string, messageId: string) => void;
  clearPatches: () => void;
  setChat: (c: ChatItem[]) => void;
  appendChat: (c: ChatItem) => void;
  setConversationId: (id: string | null) => void;
  setConversations: (c: ConversationMeta[]) => void;
  resetChat: () => void;
  setSaveState: (s: WorkbenchState["saveState"]) => void;
  showToast: (msg: string | null) => void;
};

export const useWorkbench = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      theme: "light",
      centerMode: "split",
      editorFontSize: 14,
      leftCollapsed: false,
      rightCollapsed: false,
      activeFile: null,
      openFiles: [],
      selection: null,
      compileStatus: null,
      compiling: false,
      pendingPatches: [],
      chat: [],
      conversationId: null,
      conversations: [],
      saveState: "saved",
      toast: null,

      setTheme: (theme) => set({ theme }),
      setCenterMode: (centerMode) => set({ centerMode }),
      setEditorFontSize: (editorFontSize) =>
        set({ editorFontSize: Math.max(10, Math.min(24, Math.round(editorFontSize))) }),
      setLeftCollapsed: (leftCollapsed) => set({ leftCollapsed }),
      setRightCollapsed: (rightCollapsed) => set({ rightCollapsed }),
      setActiveFile: (activeFile) => set({ activeFile, selection: null }),
      openFile: (path) => {
        const openFiles = get().openFiles.includes(path)
          ? get().openFiles
          : [...get().openFiles, path];
        set({ openFiles, activeFile: path });
      },
      closeFile: (path) => {
        const openFiles = get().openFiles.filter((f) => f !== path);
        const activeFile =
          get().activeFile === path ? openFiles[openFiles.length - 1] ?? null : get().activeFile;
        set({ openFiles, activeFile });
      },
      setSelection: (selection) => set({ selection }),
      setCompileStatus: (compileStatus) => set({ compileStatus }),
      setCompiling: (compiling) => set({ compiling }),
      addPatch: (p) => set({ pendingPatches: [...get().pendingPatches, p] }),
      updatePatch: (id, status) =>
        set({
          pendingPatches: get().pendingPatches.map((p) =>
            p.id === id ? { ...p, status } : p,
          ),
        }),
      linkPatchToMessage: (patchId, messageId) =>
        set({
          pendingPatches: get().pendingPatches.map((p) =>
            p.id === patchId ? { ...p, messageId } : p,
          ),
        }),
      setChat: (chat) => set({ chat }),
      appendChat: (c) => set({ chat: [...get().chat, c] }),
      setConversationId: (conversationId) => set({ conversationId }),
      setConversations: (conversations) => set({ conversations }),
      clearPatches: () => set({ pendingPatches: [] }),
      resetChat: () =>
        set({ chat: [], conversationId: null, pendingPatches: [] }),
      setSaveState: (saveState) => set({ saveState }),
      showToast: (toast) => {
        set({ toast });
        if (toast) setTimeout(() => set({ toast: null }), 2500);
      },
    }),
    {
      // conversationId/activeFile/openFiles are NOT persisted at all — they
      // previously leaked across projects via this global storage key and
      // showed project A's conversation while project B was open. They now
      // reset on every page load; conversations themselves live in the DB and
      // are re-fetched per project by AiPanel's useEffect.
      name: "latex-ide-workbench",
      partialize: (s) => ({
        theme: s.theme,
        centerMode: s.centerMode,
        editorFontSize: s.editorFontSize,
        leftCollapsed: s.leftCollapsed,
        rightCollapsed: s.rightCollapsed,
      }),
      // Legacy data written before the cross-project leak fix contains another
      // project's openFiles/activeFile/conversationId. Strip them on hydration
      // so a stale "main.tex" tab never appears in a project that has no such
      // file.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.openFiles?.length || state.activeFile || state.conversationId) {
          useWorkbench.setState({ openFiles: [], activeFile: null, conversationId: null });
        }
      },
    },
  ),
);
