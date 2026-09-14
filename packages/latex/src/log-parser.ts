import type { LatexDiagnostic } from "@latex-ide/contracts";

/**
 * Parse TeX / latexmk logs into structured diagnostics.
 */
export function parseLatexLog(
  log: string,
  entryFile = "main.tex",
): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = [];
  const lines = log.split(/\r?\n/);

  let currentFile = entryFile;
  const fileStack: string[] = [];

  const push = (d: LatexDiagnostic) => {
    const key = `${d.severity}|${d.filePath ?? ""}|${d.line ?? ""}|${d.message}`;
    if (
      diagnostics.some(
        (x) =>
          `${x.severity}|${x.filePath ?? ""}|${x.line ?? ""}|${x.message}` === key,
      )
    ) {
      return;
    }
    diagnostics.push(d);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // File stack tracking
    const opens = line.matchAll(/\((?:\.\/)?([^\s()]+)/g);
    for (const m of opens) {
      const name = m[1];
      if (name && /\.(tex|bib|sty|cls)$/i.test(name)) {
        const cleaned = name.replace(/^\.\//, "");
        fileStack.push(cleaned);
        currentFile = cleaned;
      }
    }
    const openCount = (line.match(/\(/g) || []).length;
    const closeCount = (line.match(/\)/g) || []).length;
    for (let c = 0; c < Math.max(0, closeCount - openCount); c++) {
      fileStack.pop();
      currentFile = fileStack[fileStack.length - 1] ?? entryFile;
    }

    // Modern TeX Live format: ./file.tex:12: message
    const modern = line.match(/^(\.\/)?([^\s:]+\.tex):(\d+):\s*(.*)$/);
    if (modern) {
      const msg = (modern[4] ?? "").trim();
      if (msg) {
        push({
          filePath: (modern[1] || "") + (modern[2] || ""),
          line: Number(modern[3]),
          severity: /warning/i.test(msg) ? "warning" : "error",
          message: msg,
          raw: line,
        });
      }
      continue;
    }

    // Classic ! errors — collect and resolve line from following l.NNN
    if (/^!\s+/.test(line)) {
      const message = line.replace(/^!\s*/, "").trim();
      let resolvedLine: number | undefined;
      let nearText: string | undefined;
      let resolvedFile = currentFile;

      for (let j = i + 1; j < Math.min(lines.length, i + 25); j++) {
        const peek = lines[j] ?? "";
        if (/^!\s+/.test(peek)) break;

        const fileHit = peek.match(/^(?:\.\/)?([^\s:]+\.tex)\s*$/);
        if (fileHit) resolvedFile = fileHit[1] ?? resolvedFile;

        const lRef = peek.match(/^l\.(\d+)\s*(.*)/);
        if (lRef) {
          resolvedLine = Number(lRef[1]);
          nearText = (lRef[2] ?? "").trim() || undefined;
          break;
        }
      }

      push({
        filePath: resolvedFile,
        line: resolvedLine,
        severity: "error",
        message: nearText ? `${message} — near: ${nearText}` : message,
        raw: line,
      });
      continue;
    }

    // Package / Class Error
    const pkgErr = line.match(/^(Package|Class)\s+(\S+)\s+Error:\s*(.*)/);
    if (pkgErr) {
      push({
        filePath: currentFile,
        severity: "error",
        message: `${pkgErr[1]} ${pkgErr[2]}: ${(pkgErr[3] || "").trim()}`,
        raw: line,
      });
      continue;
    }

    // Missing .cls / .sty / .bst — common when templates need extra TeX packages
    const notFound = line.match(/File `([^']+\.(?:cls|sty|bst))' not found/i);
    if (notFound) {
      const missing = notFound[1] ?? "";
      push({
        filePath: currentFile,
        severity: "error",
        message: `${missing} not found — install it via your TeX distribution (e.g. tlmgr install ${missing.replace(/\.[^.]+$/, "")}) or use the full TeX Live.`,
        raw: line,
      });
      continue;
    }

    // LaTeX Warning
    const warn = line.match(/^LaTeX Warning:\s*(.*)/);
    if (warn) {
      const msg = (warn[1] ?? "").trim();
      const lineRef = msg.match(/on input line (\d+)/);
      push({
        filePath: currentFile,
        line: lineRef ? Number(lineRef[1]) : undefined,
        severity: "warning",
        message: msg.replace(/\s+on input line \d+\.?$/, "").trim(),
        raw: line,
      });
      continue;
    }

    // Overfull / Underfull
    const box = line.match(/^(Overfull|Underfull)\s+\\(\w+)\s*\(([^)]*)\)/);
    if (box) {
      // TeX may put the source range on this line or the following line.
      const atLines = line.match(/at lines? (\d+)(?:--(\d+))?/i) ||
        (lines[i + 1] ?? "").match(/at lines? (\d+)(?:--(\d+))?/i);
      push({
        filePath: currentFile,
        line: atLines ? Number(atLines[1]) : undefined,
        severity: "warning",
        message: `${box[1]} \\${box[2]} (${box[3]})${atLines ? ` at line ${atLines[1]}` : ""}`,
        raw: line,
      });
    }
  }

  return diagnostics;
}

/** Heuristic: does the process exit code + log indicate failure? */
export function compileFailedFromLog(log: string, exitCode: number): boolean {
  if (exitCode !== 0) return true;
  return /^!\s+/m.test(log) || /Emergency stop/i.test(log);
}
