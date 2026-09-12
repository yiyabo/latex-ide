export type TemplateFile = { path: string; content: string };

export type TemplateName = "blank" | "paper" | "ieee" | "elsevier";

export const PAPER_TEMPLATE: TemplateFile[] = [
  {
    path: "main.tex",
    content: `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{natbib}

\\title{Toward Reliable AI-Assisted Scientific Writing}
\\author{Your Name\\\\Affiliation}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
We present a prototype AI-assisted LaTeX writing workbench that keeps the author in control: suggestions arrive as reviewable diffs, never as silent overwrites.
\\end{abstract}

\\input{sections/intro}
\\input{sections/method}
\\input{sections/related}

\\bibliographystyle{plainnat}
\\bibliography{refs}

\\end{document}
`,
  },
  {
    path: "sections/intro.tex",
    content: `\\section{Introduction}
\\label{sec:intro}

Scientific writing is an iterative process of drafting, revising, and verifying claims against evidence.
Large language models can accelerate drafting, but unconstrained generation risks fabrication of citations, silent meaning drift, and unreviewable file mutations.

This paper describes the design of a workbench in which:
\\begin{enumerate}
  \\item the author selects source text as the unit of work,
  \\item the assistant proposes edits as structured patches,
  \\item every write is gated by an explicit human review step.
\\end{enumerate}

Select this paragraph and ask the assistant to polish it.

`,
  },
  {
    path: "sections/method.tex",
    content: `\\section{Method}
\\label{sec:method}

\\subsection{Selection Context}
When the author selects a range in the editor, we capture offsets, surrounding lines, and the enclosing section path. This context is the sole default input to the assistant.

\\subsection{Patch Protocol}
Assistant tools may only emit a \\texttt{PatchProposal} consisting of offset-based replacements. Application checks an expected original substring and a base file version; any mismatch yields a conflict instead of an overwrite.

\\begin{equation}
  \\text{apply}(p) =
  \\begin{cases}
    \\text{success} & \\text{if } \\mathrm{expected}(p) = \\mathrm{current} \\\\
    \\text{conflict} & \\text{otherwise}
  \\end{cases}
\\end{equation}

`,
  },
  {
    path: "sections/related.tex",
    content: `\\section{Related Work}
\\label{sec:related}

Interactive theorem provers and literate programming systems already treat source as the single source of truth~\\citep{knuth1984}.
Recent coding assistants popularized diff review; we import that interaction model into academic prose editing.

% TODO: cite contemporary AI writing tools when verified sources are available.

`,
  },
  {
    path: "refs.bib",
    content: `@article{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111}
}
`,
  },
];

export const IEEE_TEMPLATE: TemplateFile[] = [
  {
    path: "main.tex",
    content: `\\documentclass[conference]{IEEEtran}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage{cite}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[hidelinks]{hyperref}

\\title{Your Paper Title Here\\\\
{\\large\\textsuperscript{1}}First A. Author, {\\large\\textsuperscript{2}}Second B. Author
}
\\author{\\textsuperscript{1}Department, University, City, Country\\\\
\\textsuperscript{2}Department, University, City, Country\\\\
email@university.edu}
\\date{}

\\begin{document}
\\maketitle

\\begin{abstract}
This is the abstract. Replace with a concise summary of the problem, approach, and results. IEEE conference abstracts are typically 150--250 words.
\\end{abstract}

\\begin{IEEEkeywords}
keyword1, keyword2, keyword3
\\end{IEEEkeywords}

\\section{Introduction}
IEEE conference papers use the \\texttt{IEEEtran} class. Cite like this~\\cite{knuth1984}. Sections follow the standard structure: Introduction, Related Work, Method, Experiments, Conclusion.

\\input{sections/method}
\\input{sections/related}

\\section{Conclusion}
Summarize findings and future work here.

\\bibliographystyle{IEEEtran}
\\bibliography{refs}

\\end{document}
`,
  },
  {
    path: "sections/method.tex",
    content: `\\section{Method}
\\label{sec:method}

Describe your approach here. IEEE two-column format rewards dense, well-structured prose; use \\texttt{figure*} for full-width figures.

\\begin{equation}
  \\mathrm{loss}(\\theta) = \\mathbb{E}_{(x,y)\\sim\\mathcal{D}}\\left[\\ell\\big(f_\\theta(x), y\\big)\\right]
\\end{equation}

`,
  },
  {
    path: "sections/related.tex",
    content: `\\section{Related Work}
\\label{sec:related}

Group related work by theme, not chronologically. Compare and contrast with~\\cite{knuth1984}.

`,
  },
  {
    path: "refs.bib",
    content: `@article{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111}
}
`,
  },
];

export const ELSEVIER_TEMPLATE: TemplateFile[] = [
  {
    path: "main.tex",
    content: `\\documentclass[preprint,12pt]{elsarticle}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}

\\journal{Journal Name}

\\begin{document}

\\begin{frontmatter}
  \\title{Your Paper Title Here}
  \\author[aff1]{First Author\\corref{cor1}}
  \\ead{first.author@university.edu}
  \\author[aff1,aff2]{Second Author}
  \\ead{second.author@university.edu}
  \\cortext[cor1]{Corresponding author.}
  \\affiliation[aff1]{organization={Department, University},
            city={City},
            country={Country}}
  \\affiliation[aff2]{organization={Institute},
            city={City},
            country={Country}}

  \\begin{abstract}
  Replace with a structured summary of the problem, approach, and results.
  \\end{abstract}

  \\begin{keyword}
  keyword1 \\sep keyword2 \\sep keyword3
  \\JEL code1 \\sep code2
  \\PACS code1 \\sep code2
  \\end{keyword}
\\end{frontmatter}

\\section{Introduction}
\\label{sec:intro}

Elsevier journals use the \\texttt{elsarticle} class. Cite numerically like this~\\cite{knuth1984}.

\\input{sections/method}
\\input{sections/related}

\\section{Conclusions}
\\label{sec:conclusions}

Summarize findings and future work here.

\\bibliographystyle{elsarticle-num}
\\bibliography{refs}

\\end{document}
`,
  },
  {
    path: "sections/method.tex",
    content: `\\section{Materials and Methods}
\\label{sec:method}

Describe your approach here. Use \\texttt{figure} environments as usual; \\texttt{elsarticle} handles placement.

\\begin{equation}
  \\mathrm{loss}(\\theta) = \\mathbb{E}_{(x,y)\\sim\\mathcal{D}}\\left[\\ell\\big(f_\\theta(x), y\\big)\\right]
\\end{equation}

`,
  },
  {
    path: "sections/related.tex",
    content: `\\section{Related Work}
\\label{sec:related}

Group related work by theme. Compare and contrast with~\\cite{knuth1984}.

`,
  },
  {
    path: "refs.bib",
    content: `@article{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111}
}
`,
  },
];

export const BLANK_TEMPLATE: TemplateFile[] = [
  {
    path: "main.tex",
    content: `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}

\\title{Untitled}
\\author{Author}
\\date{\\today}

\\begin{document}
\\maketitle

Start writing here.

\\end{document}
`,
  },
];

const TEMPLATES: Record<TemplateName, TemplateFile[]> = {
  blank: BLANK_TEMPLATE,
  paper: PAPER_TEMPLATE,
  ieee: IEEE_TEMPLATE,
  elsevier: ELSEVIER_TEMPLATE,
};

export function getTemplateFiles(name: TemplateName): TemplateFile[] {
  return TEMPLATES[name] ?? PAPER_TEMPLATE;
}

export function isTemplateName(v: string): v is TemplateName {
  return v in TEMPLATES;
}
