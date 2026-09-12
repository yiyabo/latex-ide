import { describe, expect, it } from "vitest";
import { buildSelectionContext, extractSectionPath } from "../selection";
import { parseLatexLog, compileFailedFromLog } from "../log-parser";

const SAMPLE = `\\documentclass{article}
\\begin{document}
\\section{Introduction}
This is the introduction text about AI systems.

\\subsection{Background}
More background details here for the reader.
\\end{document}
`;

describe("selection", () => {
  it("returns null for empty selection", () => {
    expect(
      buildSelectionContext({
        projectId: "p1",
        filePath: "main.tex",
        documentText: SAMPLE,
        selectionStart: 10,
        selectionEnd: 10,
      }),
    ).toBeNull();
  });

  it("builds context for a selection inside Introduction", () => {
    const start = SAMPLE.indexOf("This is the introduction");
    const end = start + 24;
    const ctx = buildSelectionContext({
      projectId: "p1",
      filePath: "sections/intro.tex",
      documentText: SAMPLE,
      selectionStart: start,
      selectionEnd: end,
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.selectedText).toBe("This is the introduction");
    expect(ctx?.sectionPath).toContain("Introduction");
    expect(ctx?.language).toBe("tex");
    expect(ctx?.cursorLine).toBeGreaterThan(1);
  });

  it("extracts nested section path", () => {
    const start = SAMPLE.indexOf("More background");
    expect(extractSectionPath(SAMPLE, start)).toEqual([
      "Introduction",
      "Background",
    ]);
  });
});

describe("log parser", () => {
  it("parses missing brace / undefined control sequence errors", () => {
    const log = `
This is pdfTeX
(./main.tex
! Undefined control sequence.
l.12 \\undefinedcmd

! Missing } inserted.
<inserted text>
                }
l.20 \\end{document}

Overfull \\hbox (12.0pt too wide) in paragraph at lines 5--7
LaTeX Warning: Citation 'smith2020' on page 1 undefined on input line 30.
`;
    const diags = parseLatexLog(log, "main.tex");
    expect(diags.some((d) => d.severity === "error" && /Undefined control/.test(d.message))).toBe(true);
    expect(diags.some((d) => d.severity === "error" && /Missing/.test(d.message))).toBe(true);
    expect(diags.some((d) => d.severity === "warning" && /Overfull/.test(d.message))).toBe(true);
    expect(diags.some((d) => d.severity === "warning" && /Citation/.test(d.message))).toBe(true);

    const undef = diags.find((d) => /Undefined control/.test(d.message));
    expect(undef?.line).toBe(12);
  });

  it("detects failure from exit code and log", () => {
    expect(compileFailedFromLog("ok", 1)).toBe(true);
    expect(compileFailedFromLog("! Emergency stop.", 0)).toBe(true);
    expect(compileFailedFromLog("Output written", 0)).toBe(false);
  });
});
