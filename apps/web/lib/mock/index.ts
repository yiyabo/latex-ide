import type { EditorSelectionContext, PatchProposal } from "@latex-ide/contracts";

export const MOCK_FILES: Record<string, string> = {
  "main.tex": `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}
\\usepackage{hyperref}

\\title{Toward Reliable AI-Assisted Scientific Writing}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
We present a prototype AI-assisted LaTeX writing workbench.
\\end{abstract}

\\input{sections/intro}

\\end{document}
`,
  "sections/intro.tex": `\\section{Introduction}

Scientific writing is an iterative process of drafting, revising, and verifying claims.
Select this sentence and ask the assistant to polish it.

\\subsection{Contributions}
Our contributions include a selection-driven context model and a patch review protocol.
`,
};

export function mockPatchFromSelection(sel: EditorSelectionContext): PatchProposal {
  const old = sel.selectedText;
  let neu = old
    .replace(/\bvery\s+/gi, "")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\bdue to the fact that\b/gi, "because");
  if (neu === old) neu = old.replace(/\.$/, "") + ", revised.";

  return {
    id: `mock-${Date.now()}`,
    conversationId: "mock-conv",
    summary: "Polish selection for clarity",
    operations: [
      {
        type: "replace",
        filePath: sel.filePath,
        start: sel.selectionStart,
        end: sel.selectionEnd,
        expectedOldText: old,
        newText: neu,
      },
    ],
    baseVersionId: "mock-base",
    status: "pending",
  };
}
