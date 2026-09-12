"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { oneDark } from "@codemirror/theme-one-dark";
import { buildSelectionContext } from "@latex-ide/latex";
import { useWorkbench } from "@/lib/stores/workbench";

const SURROUND_DECO = Decoration.mark({ class: "cm-surround" });

function surroundPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: { docChanged: boolean; selectionSet: boolean; view: EditorView }) {
        if (u.docChanged || u.selectionSet) this.decorations = this.build(u.view);
      }
      build(view: EditorView): DecorationSet {
        const sel = view.state.selection.main;
        if (sel.empty) return Decoration.none;
        // subtle background handled by ::selection
        return Decoration.none;
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export function LatexEditor({
  projectId,
  filePath,
  value,
  onChange,
  onSave,
}: {
  projectId: string;
  filePath: string;
  value: string;
  onChange?: (v: string) => void;
  onSave?: (v: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeComp = useRef(new Compartment());
  const { theme, setSelection, showToast, setSaveState } = useWorkbench();
  const valueRef = useRef(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const updateSelection = useCallback(
    (view: EditorView) => {
      const state = view.state;
      const main = state.selection.main;
      const doc = state.doc.toString();
      const ctx = buildSelectionContext({
        projectId,
        filePath,
        documentText: doc,
        selectionStart: main.from,
        selectionEnd: main.to,
        surroundingRadius: 20,
      });
      setSelection(ctx);
    },
    [projectId, filePath, setSelection],
  );

  useEffect(() => {
    if (!hostRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          const doc = viewRef.current?.state.doc.toString() ?? "";
          onSaveRef.current?.(doc);
          showToast("Saved");
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        highlightSelectionMatches(),
        surroundPlugin(),
        StreamLanguage.define(stex),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        saveKeymap,
        themeComp.current.of(theme === "dark" ? oneDark : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const doc = u.state.doc.toString();
            valueRef.current = doc;
            setSaveState("dirty");
            onChangeRef.current?.(doc);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              onSaveRef.current?.(doc);
            }, 2000);
          }
          if (u.selectionSet || u.docChanged) {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            // debounce selection 300ms
            const t = setTimeout(() => updateSelection(u.view), 300);
            (debounceRef as { current: unknown }).current = t;
          }
        }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-content": { caretColor: "rgb(var(--accent))" },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filePath]);

  // Theme
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeComp.current.reconfigure(theme === "dark" ? oneDark : []),
    });
  }, [theme]);

  // External value sync
  useEffect(() => {
    if (!viewRef.current) return;
    const current = viewRef.current.state.doc.toString();
    if (current !== value) {
      valueRef.current = value;
      viewRef.current.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Apply a precise replacement (used by patch accept)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ from: number; to: number; insert: string }>).detail;
      if (!viewRef.current || !detail) return;
      const { from, to, insert } = detail;
      viewRef.current.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      viewRef.current.focus();
    };
    window.addEventListener("latex-ide:replace", handler);
    return () => window.removeEventListener("latex-ide:replace", handler);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-surface" ref={hostRef} />
  );
}

// helper exported for patch apply
export function dispatchEditorReplace(from: number, to: number, insert: string) {
  window.dispatchEvent(
    new CustomEvent("latex-ide:replace", { detail: { from, to, insert } }),
  );
}
