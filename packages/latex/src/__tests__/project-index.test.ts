import { describe, it, expect } from "vitest";
import { buildProjectIndex, summarizeIndex } from "../project-index";

function mapOf(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("buildProjectIndex", () => {
  const main = `\\documentclass{article}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{fontspec}
\\begin{document}
\\section{Introduction}
See Figure~\\ref{fig:roc} and Table~\\ref{tab:missing}.
\\includegraphics[width=0.9\\textwidth]{figures/validation.png}
\\includegraphics{orphan}% comment with \\label{fake}
\\cite{goodkey2020}
\\cite{missingkey}
% a comment \\includegraphics{figures/hidden.png}
\\input{sections/method}
\\bibliography{refs}
\\end{document}`;
  const method = `\\section{Method}
\\label{fig:roc}
Some math.
\\section{Results}
\\label{sec:results}`;
  const refs = `@article{goodkey2020, author={A}, title={T}, year={2020}}`;

  const files = mapOf({
    "main.tex": main,
    "sections/method.tex": method,
    "refs.bib": refs,
    "figures/validation.png": "PNG",
    "figures/orphan.png": "PNG",
  });

  const idx = buildProjectIndex(files);

  it("detects entry file", () => {
    expect(idx.entryFile).toBe("main.tex");
  });

  it("builds input graph with .tex resolution", () => {
    expect(idx.inputGraph["main.tex"]).toContain("sections/method.tex");
  });

  it("detects packages and engine hints", () => {
    expect(idx.packages).toContain("graphicx");
    expect(idx.packages).toContain("amsmath");
    expect(idx.engineHints).toContain("xelatex"); // fontspec
  });

  it("reconciles figures: found, orphaned, missing", () => {
    expect(idx.referencedFigures).toContain("figures/validation.png");
    expect(idx.referencedFigures).toContain("orphan");
    // "orphan" without ext resolves to figures/orphan.png via normalization,
    // so it is NOT orphaned and NOT missing
    expect(idx.orphanedFigures).toEqual([]);
    expect(idx.missingFigures).not.toContain("orphan");
    // commented includegraphics must be ignored
    expect(idx.referencedFigures).not.toContain("figures/hidden.png");
  });

  it("reconciles labels and refs", () => {
    expect(idx.labels["fig:roc"]).toBe("sections/method.tex");
    expect(idx.missingLabels).toContain("tab:missing");
    expect(idx.missingLabels).not.toContain("fig:roc");
  });

  it("reconciles citations with bib entries", () => {
    expect(idx.bibFiles).toContain("refs.bib");
    expect(idx.missingCitations).toContain("missingkey");
    expect(idx.missingCitations).not.toContain("goodkey2020");
  });

  it("lists sections", () => {
    const titles = idx.sections.map((s) => s.title);
    expect(titles).toContain("Introduction");
    expect(titles).toContain("Method");
    expect(titles).toContain("Results");
  });

  it("summarizeIndex mentions the actionable problems", () => {
    const s = summarizeIndex(idx);
    expect(s).toContain("MISSING LABELS");
    expect(s).toContain("MISSING CITATIONS");
    expect(s).toContain("xelatex");
  });

  it("handles empty projects without crashing", () => {
    const empty = buildProjectIndex(mapOf({}));
    expect(empty.entryFile).toBeNull();
    expect(empty.missingFigures).toEqual([]);
  });
});
