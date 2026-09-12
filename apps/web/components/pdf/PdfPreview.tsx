"use client";

import { useState } from "react";
import { FileWarning, Loader2 } from "lucide-react";

export function PdfPreview({ url }: { url: string | null }) {
  const [error, setError] = useState(false);

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

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <FileWarning size={28} />
        <p className="text-sm">Failed to render PDF</p>
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
          Open in new tab
        </a>
      </div>
    );
  }

  return (
    <div className="thin-scroll h-full w-full overflow-auto bg-elevated/50 p-4">
      <iframe
        src={url}
        className="mx-auto h-full min-h-[800px] w-full max-w-[720px] rounded border border-border bg-white shadow-lg"
        title="PDF preview"
        onError={() => setError(true)}
      />
      {/* Fallback note for browsers blocking iframes of auth'd PDFs */}
      <p className="mt-2 text-center text-2xs text-muted">
        If the preview is blank, open the PDF in a new tab from the toolbar.
      </p>
    </div>
  );
}

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
