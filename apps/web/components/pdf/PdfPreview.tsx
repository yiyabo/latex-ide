"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { FileWarning, Loader2, Sparkles, Highlighter } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";

/* ------------------------------------------------------------------ */
/* Translation popup                                                   */
/* ------------------------------------------------------------------ */

type Tool = "translate" | "highlight";

interface SelectionState {
  text: string;
  x: number;
  y: number;
  page: number;
  rects: Array<{ left: number; top: number; width: number; height: number }>;
}

/** Extract the English words from a text selection and ask the AI provider
 *  to translate them into academic Chinese. Uses the same chat endpoint as
 *  the AI panel so no extra provider config is needed. */
async function translateSelection(text: string): Promise<string> {
  const res = await fetch("/api/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 4000) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { translation: string };
  return data.translation;
}

/* ------------------------------------------------------------------ */
/* Highlights overlay                                                  */
/* ------------------------------------------------------------------ */

interface Highlight {
  page: number;
  rects: Array<{ left: number; top: number; width: number; height: number }>;
  color: string;
  text: string;
}

const HIGHLIGHT_COLORS = ["#fde68a", "#a7f3d0", "#bfdbfe", "#fca5a5"];

/* ------------------------------------------------------------------ */
/* PdfPreview                                                          */
/* ------------------------------------------------------------------ */

function PdfPreviewInner({ url }: { url: string | null }) {
  const [numPages, setNumPages] = useState(0);
  const [pdfScale, setPdfScale] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Selection popup state
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [tool, setTool] = useState<Tool>("translate"); // default: translate
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [transError, setTransError] = useState<string | null>(null);
  const selTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextMouseUp = useRef(false);
  const pdfHasFocus = useRef(false);

  // Highlights (in-memory for now; keyed by page)
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightVersion, setHighlightVersion] = useState(0); // bump to re-render overlays

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setLoadError(false);
  }, []);

  const onDocumentLoadError = useCallback(() => setLoadError(true), []);

  const dismissPopup = useCallback(() => {
    setSelection(null);
    setTranslation(null);
    setTransError(null);
    setTranslating(false);
    window.getSelection()?.removeAllRanges();
  }, []);

  /* ---- selection → popup ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      pdfHasFocus.current = true;
      if (suppressNextMouseUp.current) {
        suppressNextMouseUp.current = false;
        return;
      }
      if (selTimer.current) clearTimeout(selTimer.current);
      selTimer.current = setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || sel.isCollapsed || text.length < 2) {
          // Clicking/dragging away from the PDF selection must close any
          // existing translation popup instead of leaving stale content.
          dismissPopup();
          return;
        }
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const hostRect = container.getBoundingClientRect();
        const viewportRects = Array.from(range.getClientRects())
          .map((r) => ({
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
          }))
          .filter((r) => r.width > 1 && r.height > 1);
        const firstRect = viewportRects[0];
        if (!firstRect) return;

        let page = 1;
        let pageEl: HTMLDivElement | undefined;
        for (const [p, el] of pageRefs.current) {
          const pageRect = el.getBoundingClientRect();
          if (firstRect.top >= pageRect.top && firstRect.top < pageRect.bottom) {
            page = p;
            pageEl = el;
            break;
          }
        }
        const pageRect = pageEl?.getBoundingClientRect();
        if (!pageRect) return;
        const pageRelRects = viewportRects
          .filter((r) => r.top >= pageRect.top && r.top < pageRect.bottom)
          .map((r) => ({
            left: r.left - pageRect.left,
            top: r.top - pageRect.top,
            width: r.width,
            height: r.height,
          }));
        if (pageRelRects.length === 0) return;

        setSelection({
          text,
          x: rect.left - hostRect.left + rect.width / 2,
          y: rect.top - hostRect.top - 8,
          page,
          rects: pageRelRects,
        });
        // Default tool is translate: fire immediately on selection
        setTranslation(null);
        setTransError(null);
        setTranslating(true);
      }, 350); // debounce: let text selection settle
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      if (selTimer.current) clearTimeout(selTimer.current);
    };
    // Re-attach when the preview mounts: with url === null the component
    // renders the "No PDF yet" branch, containerRef is null, and the guard
    // above returns early — without this dependency the listener would
    // never attach after the first successful compile.
  }, [url, dismissPopup]);

  // Auto-translate when selection arrives with tool=translate (default)
  useEffect(() => {
    if (!selection || tool !== "translate") return;
    let cancelled = false;
    setTranslating(true);
    setTransError(null);
    translateSelection(selection.text)
      .then((t) => {
        if (!cancelled) setTranslation(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) setTransError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setTranslating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, tool]);

  const addHighlight = useCallback(() => {
    if (!selection || selection.rects.length === 0) return;

    const color = HIGHLIGHT_COLORS[highlights.length % HIGHLIGHT_COLORS.length] ?? "#fde68a";
    setHighlights((prev) => [
      ...prev,
      {
        page: selection.page,
        rects: selection.rects,
        color,
        text: selection.text.slice(0, 200),
      },
    ]);
    setHighlightVersion((v) => v + 1);
    dismissPopup();
  }, [selection, dismissPopup, highlights.length]);

  const removeLastHighlight = useCallback(() => {
    setHighlights((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
    setHighlightVersion((v) => v + 1);
  }, []);

  // Treat highlights like normal editor annotations: Command/Ctrl+Z removes
  // the most recent one, without hijacking undo outside the PDF preview.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
      if (!isUndo || highlights.length === 0 || !pdfHasFocus.current) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        Boolean(target?.closest('textarea, input, [contenteditable="true"]'))
      ) {
        return;
      }
      event.preventDefault();
      removeLastHighlight();
      dismissPopup();
    };
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      pdfHasFocus.current = Boolean(target && containerRef.current?.contains(target));
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [dismissPopup, highlights.length, removeLastHighlight]);

  const file = useMemo(() => (url ? { url } : null), [url]);

  /* ---- reset when url changes ---- */
  useEffect(() => {
    setNumPages(0);
    setLoadError(false);
    setHighlights([]);
    dismissPopup();
  }, [url, dismissPopup]);

  if (!url) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <div className="rounded-full bg-elevated p-4">
          <FileWarning size={28} strokeWidth={1.5} />
        </div>
        <p className="text-sm">No PDF yet. Compile the project to preview.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute right-5 top-3 z-30 flex items-center gap-1 rounded-md border border-border bg-surface/95 p-1 shadow-md">
        <button
          type="button"
          onClick={() => setPdfScale((s) => Math.max(0.6, Number((s - 0.1).toFixed(1))))}
          className="pointer-events-auto rounded p-1 text-muted hover:bg-elevated hover:text-ink"
          aria-label="缩小 PDF"
          title="缩小 PDF"
        >
          −
        </button>
        <span className="min-w-10 text-center text-2xs text-muted">{Math.round(pdfScale * 100)}%</span>
        <button
          type="button"
          onClick={() => setPdfScale((s) => Math.min(2, Number((s + 0.1).toFixed(1))))}
          className="pointer-events-auto rounded p-1 text-muted hover:bg-elevated hover:text-ink"
          aria-label="放大 PDF"
          title="放大 PDF"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setPdfScale(1)}
          className="pointer-events-auto rounded px-1.5 py-1 text-2xs text-muted hover:bg-elevated hover:text-ink"
          aria-label="重置 PDF 缩放"
          title="重置缩放"
        >
          适合
        </button>
      </div>
      <div ref={containerRef} className="thin-scroll h-full w-full overflow-auto bg-elevated/50 p-4">
        <Document
          file={file}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex h-40 items-center justify-center text-muted">
              <Loader2 className="animate-spin" />
            </div>
          }
          error={
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted">
              <FileWarning size={28} />
              <p className="text-sm">Failed to render PDF</p>
            </div>
          }
          className="mx-auto w-full max-w-[720px]"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i + 1}
              ref={(el) => {
                if (el) pageRefs.current.set(i + 1, el);
                else pageRefs.current.delete(i + 1);
              }}
              className="relative mb-4"
              data-page={i + 1}
            >
              <Page
                pageNumber={i + 1}
                width={Math.round(680 * pdfScale)}
                renderTextLayer
                renderAnnotationLayer
                loading={
                  <div className="flex h-[880px] items-center justify-center rounded border border-border bg-white">
                    <Loader2 className="animate-spin text-muted" />
                  </div>
                }
              />
              {/* Render after Page so the highlight is visible above canvas/text. */}
              {highlights
                .filter((h) => h.page === i + 1)
                .map((h, hi) => (
                  <div key={`h-${highlightVersion}-${hi}`} className="pointer-events-none absolute inset-0 z-10">
                    {h.rects.map((r, ri) => (
                      <div
                        key={ri}
                        className="absolute rounded-sm"
                        style={{
                          left: r.left,
                          top: r.top,
                          width: r.width,
                          height: r.height,
                          backgroundColor: h.color,
                          opacity: 0.45,
                        }}
                      />
                    ))}
                  </div>
                ))}
            </div>
          ))}
        </Document>
      </div>

      {/* Floating selection toolbar / translation popup */}
      {selection && (
        <div
          className="absolute z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: selection.x, top: selection.y }}
        >
          <div className="w-[340px] rounded-lg border border-border bg-surface shadow-xl">
            {/* Toolbar row */}
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              <button
                onMouseDown={() => {
                  suppressNextMouseUp.current = true;
                }}
                onClick={() => setTool("translate")}
                className={`flex items-center gap-1 rounded px-2 py-1 text-2xs ${
                  tool === "translate" ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"
                }`}
                title="选中文本后自动翻译"
              >
                <Sparkles size={12} /> 翻译
              </button>
              <button
                onMouseDown={() => {
                  suppressNextMouseUp.current = true;
                }}
                onClick={addHighlight}
                className="flex items-center gap-1 rounded px-2 py-1 text-2xs text-muted hover:text-ink"
                title="高亮选中内容"
              >
                <Highlighter size={12} /> 高亮
              </button>
              <div className="flex-1" />
              <button
                onMouseDown={() => {
                  suppressNextMouseUp.current = true;
                }}
                onClick={dismissPopup}
                className="rounded px-1.5 py-1 text-2xs text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
            {/* Content row */}
            <div className="max-h-56 overflow-y-auto px-3 py-2">
              {tool === "translate" && (
                <>
                  {translating && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Loader2 size={12} className="animate-spin" /> 翻译中…
                    </div>
                  )}
                  {transError && (
                    <div className="text-xs text-danger">翻译失败：{transError}</div>
                  )}
                  {translation && (
                    <div className="whitespace-pre-wrap text-xs leading-relaxed text-ink">
                      {translation}
                    </div>
                  )}
                </>
              )}
              {tool === "highlight" && (
                <div className="text-xs text-muted">
                  点击上方「高亮」按钮标记这段文字。
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const PdfPreview = memo(PdfPreviewInner);

export function CompileStatusBar({
  status,
  onJump,
}: {
  status: { status: string; diagnostics: Array<{ severity: string; filePath?: string; line?: number; message: string }>; durationMs?: number } | null;
  onJump?: (filePath: string, line?: number) => void;
}) {
  if (!status) return null;
  const errors = status.diagnostics.filter((d) => d.severity === "error");
  const warnings = status.diagnostics.filter((d) => d.severity === "warning");
  const tone =
    status.status === "success"
      ? "text-success"
      : status.status === "running" || status.status === "queued"
        ? "text-accent"
        : "text-danger";

  return (
    <div className="border-t border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-3 text-2xs">
        <span className={`font-medium ${tone}`}>
          {status.status === "running" || status.status === "queued" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> {status.status}
            </span>
          ) : (
            status.status
          )}
        </span>
        <span className="text-muted">
          {errors.length} err · {warnings.length} warn
          {status.durationMs != null && status.durationMs > 0
            ? ` · ${(status.durationMs / 1000).toFixed(1)}s`
            : ""}
        </span>
      </div>
      {status.diagnostics.length > 0 && (
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
          {status.diagnostics.slice(0, 20).map((d, i) => (
            <li key={i}>
              <button
                onClick={() => d.filePath && onJump?.(d.filePath, d.line)}
                className="w-full text-left text-2xs hover:underline"
              >
                <span
                  className={
                    d.severity === "error" ? "text-danger" : d.severity === "warning" ? "text-warn" : "text-muted"
                  }
                >
                  {d.severity}
                </span>{" "}
                <span className="text-muted">
                  {d.filePath}
                  {d.line ? `:${d.line}` : ""}
                </span>{" "}
                <span className="text-ink">{d.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
