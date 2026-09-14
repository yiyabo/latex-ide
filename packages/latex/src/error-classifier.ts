import type { LatexDiagnostic } from "@latex-ide/contracts";

/**
 * Classify LaTeX compile diagnostics into actionable categories so the
 * compile-fixing agent can route each problem to the right repair strategy.
 * Layout warnings remain informational unless the user opts into fixing them.
 */

export type ErrorCategory =
  | "missing_file" // File `x' not found — figure/image/input
  | "missing_figure" // subset of missing_file, image-specific
  | "undefined_control" // Undefined control sequence — typo or missing package
  | "missing_package" // File `x.sty' not found
  | "missing_environment" // \begin{x} without \end{x} / Environment x undefined
  | "math_mode" // Missing $ inserted / display math errors
  | "label_ref" // Reference undefined / multiply defined labels
  | "citation" // Citation undefined / BibTeX missing entry
  | "bibtex_error" // BibTeX/Biber run failures
  | "encoding" // Unicode chars in pdflatex / inputenc issues
  | " fatal" // Emergency stop / fatal — downstream of an earlier error
  | "warning" // Overfull/Underfull hbox — cosmetic; fix only when requested
  | "other";

export type ClassifiedDiagnostic = LatexDiagnostic & {
  category: ErrorCategory;
  /** true when the agent should attempt an automatic fix proposal */
  autoFixable: boolean;
};

const CATEGORY_RULES: Array<{
  category: ErrorCategory;
  test: (msg: string) => boolean;
  autoFixable: boolean;
}> = [
  {
    category: "missing_package",
    test: (m) => /File `[^']+\.sty' not found/i.test(m) || /not found.*\.sty/i.test(m),
    autoFixable: false, // needs tlmgr install — environment fix, report only
  },
  {
    category: "missing_figure",
    test: (m) =>
      /File `[^']+\.(png|jpe?g|pdf|eps|gif|tiff?)' not found/i.test(m) ||
      /Unable to load picture or PDF file/i.test(m) ||
      /Image inclusion failed/i.test(m),
    autoFixable: true, // check_figure_paths can locate the right path
  },
  {
    category: "missing_file",
    test: (m) => /File `[^']+' not found/i.test(m),
    autoFixable: true, // often \input/\include path — index can resolve
  },
  {
    category: "citation",
    test: (m) =>
      /Citation .* undefined/i.test(m) ||
      /There were undefined references/i.test(m) ||
      /Citation .* on page/i.test(m),
    autoFixable: true, // search_literature can supply a real reference
  },
  {
    category: "label_ref",
    test: (m) =>
      /Reference .* undefined/i.test(m) ||
      /Label .* multiply defined/i.test(m) ||
      /There were undefined labels/i.test(m),
    autoFixable: true, // get_project_index finds the missing \label site
  },
  {
    category: "bibtex_error",
    test: (m) =>
      /BibTeX error/i.test(m) ||
      /I found no \\citation/i.test(m) ||
      /I couldn't open style file/i.test(m) ||
      /biber/i.test(m) && /error/i.test(m),
    autoFixable: true,
  },
  {
    category: "math_mode",
    test: (m) =>
      /Missing \$ inserted/i.test(m) ||
      /Display math should end with \$\$/i.test(m) ||
      /Bad math environment delimiter/i.test(m) ||
      /Missing \\(begin|end)\{displaymath\}/i.test(m) ||
      /double superscript/i.test(m),
    autoFixable: true,
  },
  {
    category: "missing_environment",
    test: (m) =>
      /\\begin\{(\w+)\} on input line .* ended by \\end\{(\w+)\}/i.test(m) ||
      /Environment \w+ undefined/i.test(m) ||
      /No counter.*defined/i.test(m) ||
      /\\begin\{document\} ended by \\end\{/i.test(m),
    autoFixable: true,
  },
  {
    category: "undefined_control",
    test: (m) => /Undefined control sequence/i.test(m),
    autoFixable: true,
  },
  {
    category: "encoding",
    test: (m) =>
      /Unicode character .* not set up for use with LaTeX/i.test(m) ||
      /Invalid UTF-8 byte/i.test(m) ||
      /inputenc Error/i.test(m),
    autoFixable: true, // usually engine switch or \\ensuremath fixes
  },
  {
    category: " fatal",
    test: (m) =>
      /Emergency stop/i.test(m) ||
      /Fatal error occurred/i.test(m) ||
      /no output PDF file produced/i.test(m),
    autoFixable: false, // downstream symptom — fix the root cause instead
  },
  {
    category: "warning",
    test: (m) =>
      /^(Overfull|Underfull) \\[hv]box/i.test(m) ||
      /^LaTeX Warning:.*(hbox|vbox)/i.test(m),
    autoFixable: true, // eligible only when the user explicitly asks to fix layout warnings
  },
];

export function classifyDiagnostic(d: LatexDiagnostic): ClassifiedDiagnostic {
  const msg = d.message || "";
  for (const rule of CATEGORY_RULES) {
    if (rule.test(msg)) {
      return { ...d, category: rule.category, autoFixable: rule.autoFixable };
    }
  }
  return { ...d, category: d.severity === "warning" ? "warning" : "other", autoFixable: false };
}

export function classifyDiagnostics(diags: LatexDiagnostic[]): ClassifiedDiagnostic[] {
  return diags.map(classifyDiagnostic);
}

/**
 * Prioritized fix plan: root-cause errors first (each earlier error cascades).
 * Layout warnings stay informational by default and enter the fix plan only
 * when the caller explicitly opts in.
 */
export function buildFixPlan(
  diags: LatexDiagnostic[],
  options: { includeLayoutWarnings?: boolean } = {},
): {
  fixable: ClassifiedDiagnostic[];
  environmentOnly: ClassifiedDiagnostic[];
  noise: ClassifiedDiagnostic[];
  plan: string[];
} {
  const classified = classifyDiagnostics(diags);
  const fatalIdx = classified.filter((d) => d.category === " fatal");
  const fixable = classified
    .filter(
      (d) => d.autoFixable &&
        (d.category !== "warning" || options.includeLayoutWarnings === true),
    )
    // root causes first: missing files/packages before their downstream effects
    .sort((a, b) => rank(a.category) - rank(b.category));
  const environmentOnly = classified.filter(
    (d) => !d.autoFixable && d.category !== "warning" && d.category !== " fatal",
  );
  const noise = classified.filter(
    (d) => d.category === " fatal" || (d.category === "warning" && !options.includeLayoutWarnings),
  );

  const plan: string[] = [];
  if (options.includeLayoutWarnings) {
    const layoutWarnings = classified.filter((d) => d.category === "warning");
    if (layoutWarnings.length) {
      plan.push(
        `按用户要求处理 ${layoutWarnings.length} 条排版警告（Overfull/Underfull hbox/vbox）；先定位对应段落，再提交最小 diff，并重新编译验证。`,
      );
    }
  }
  if (fixable.length) {
    plan.push(
      `修复 ${fixable.length} 个可自动处理的问题（按优先级）：`,
      ...fixable.slice(0, 6).map((d, i) =>
        `  ${i + 1}. [${d.category}] ${d.filePath ?? "?"}${d.line ? `:${d.line}` : ""} — ${d.message.slice(0, 100)}`,
      ),
    );
  }
  if (environmentOnly.length) {
    plan.push(
      `环境问题（需要安装宏包/引擎，不自动修）：`,
      ...environmentOnly.slice(0, 3).map((d) => `  · ${d.message.slice(0, 100)}`),
    );
  }
  if (noise.length) {
    const warns = noise.filter((d) => d.category === "warning").length;
    if (warns) plan.push(`另有 ${warns} 条排版警告（Overfull/Underfull hbox），不影响编译，暂不处理。`);
    if (fatalIdx.length)
      plan.push(`注意：检测到 Fatal/Emergency stop —— 这是上述根因错误的连锁反应，修复根因后重编译。`);
  }
  return { fixable, environmentOnly, noise, plan };
}

function rank(c: ErrorCategory): number {
  const order: ErrorCategory[] = [
    "missing_package",
    "missing_figure",
    "missing_file",
    "citation",
    "label_ref",
    "bibtex_error",
    "undefined_control",
    "missing_environment",
    "math_mode",
    "encoding",
    "other",
  ];
  const i = order.indexOf(c);
  return i === -1 ? 99 : i;
}
