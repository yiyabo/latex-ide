import type { FileTreeNode } from "@latex-ide/contracts";

/**
 * LaTeX project index — one static scan answering the questions the agent
 * otherwise burns 4-6 tool rounds on:
 *   - what files exist and what role they play
 *   - which figures are referenced vs orphaned
 *   - which \ref targets are missing a \label
 *   - which \cite keys are missing from .bib files
 *   - which packages are loaded
 * Pure string analysis: no filesystem, no DB — caller supplies a file map.
 */

export type ProjectIndex = {
  entryFile: string | null;
  inputGraph: Record<string, string[]>; // file -> files it \input's/\include's
  referencedFigures: string[]; // \includegraphics targets as written
  figuresOnDisk: string[]; // image files present in the project
  orphanedFigures: string[]; // on disk but never referenced
  missingFigures: string[]; // referenced but not on disk
  labels: Record<string, string>; // label -> file it's defined in
  refs: Array<{ key: string; file: string }>;
  missingLabels: string[]; // \ref with no matching \label
  citations: Array<{ key: string; file: string }>;
  bibFiles: string[];
  missingCitations: string[]; // \cite key not defined in any .bib
  packages: string[];
  engineHints: string[]; // detected from \usepackage (fontspec → xelatex …)
  sections: Array<{ file: string; title: string }>;
};

const IMAGE_EXT = /\.(png|jpe?g|pdf|eps|gif|tiff?)$/i;
const TEX_EXT = /\.tex$/i;

function stripComments(src: string): string {
  // Remove unescaped % comments (keep \%)
  return src
    .split("\n")
    .map((line) => line.replace(/(?<!\\)%.*$/, ""))
    .join("\n");
}

function texFileMap(files: Map<string, string>): string[] {
  return [...files.keys()].filter((f) => TEX_EXT.test(f)).sort();
}

export function buildProjectIndex(files: Map<string, string>): ProjectIndex {
  const onDisk = new Set(files.keys());
  const index: ProjectIndex = {
    entryFile: null,
    inputGraph: {},
    referencedFigures: [],
    figuresOnDisk: [...onDisk].filter((f) => IMAGE_EXT.test(f)).sort(),
    orphanedFigures: [],
    missingFigures: [],
    labels: {},
    refs: [],
    missingLabels: [],
    citations: [],
    bibFiles: [...onDisk].filter((f) => /\.bib$/i.test(f)).sort(),
    missingCitations: [],
    packages: [],
    engineHints: [],
    sections: [],
  };

  const bibKeys = new Set<string>();
  for (const [path, content] of files) {
    if (/\.bib$/i.test(path)) {
      for (const m of content.matchAll(/@\w+\{([^,\s]+)\s*,/g)) {
        bibKeys.add(m[1]!.trim());
      }
    }
  }

  const figureRefs = new Set<string>();
  const labels = new Map<string, string>();
  const refs: Array<{ key: string; file: string }> = [];
  const citations: Array<{ key: string; file: string }> = [];
  const packages = new Set<string>();
  const engineHints = new Set<string>();
  const sections: Array<{ file: string; title: string }> = [];
  let entryFile: string | null = null;

  for (const path of texFileMap(files)) {
    const src = stripComments(files.get(path) ?? "");
    index.inputGraph[path] = [];

    // Entry: root \documentclass
    if (/\\documentclass/.test(src) && !entryFile) entryFile = path;

    // \input / \include graph (resolve later against disk)
    for (const m of src.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
      const target = m[1]!.trim();
      const candidates = [
        target.endsWith(".tex") ? target : `${target}.tex`,
        target,
      ];
      const resolved = candidates.find((c) => onDisk.has(c));
      index.inputGraph[path].push(resolved ?? target);
    }

    // Figures
    for (const m of src.matchAll(
      /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g,
    )) {
      const fig = m[1]!.trim();
      figureRefs.add(fig);
      index.referencedFigures.push(fig);
    }

    // Labels & refs
    for (const m of src.matchAll(/\\label\{([^}]+)\}/g)) {
      labels.set(m[1]!.trim(), path);
    }
    for (const m of src.matchAll(
      /\\(?:ref|autoref|cref|Cref|pageref|eqref)\{([^}]+)\}/g,
    )) {
      for (const k of m[1]!.split(",")) {
        const key = k.trim();
        if (key) refs.push({ key, file: path });
      }
    }

    // Citations (natbib/biblatex styles)
    for (const m of src.matchAll(
      /\\(?:cite|citep|citet|citealp|autocite|textcite|parencite|footcite)(?:\[[^\]]*\])?\{([^}]+)\}/g,
    )) {
      for (const k of m[1]!.split(",")) {
        const key = k.trim();
        if (key) citations.push({ key, file: path });
      }
    }

    // Packages + engine hints
    for (const m of src.matchAll(
      /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g,
    )) {
      for (const p of m[1]!.split(",")) {
        const pkg = p.trim();
        if (pkg) {
          packages.add(pkg);
          if (pkg === "fontspec") engineHints.add("xelatex");
          if (pkg === "xeCJK") engineHints.add("xelatex");
          if (pkg === "luaotfload" || pkg === "luacode") engineHints.add("lualatex");
        }
      }
    }
    if (/\\usepackage\{unicode-math\}/.test(src)) engineHints.add("lualatex");

    // Sections (top-level only)
    for (const m of src.matchAll(/\\section\*?\{([^}]+)\}/g)) {
      sections.push({ file: path, title: m[1]!.trim() });
    }
  }

  // Bibliography files referenced via \bibliography{} — cross with disk
  for (const path of texFileMap(files)) {
    const src = stripComments(files.get(path) ?? "");
    for (const m of src.matchAll(
      /\\(?:bibliography|addbibresource)\{([^}]+)\}/g,
    )) {
      const target = m[1]!.trim();
      const candidates = [
        target.endsWith(".bib") ? target : `${target}.bib`,
        target,
      ];
      const resolved = candidates.find((c) => onDisk.has(c));
      if (resolved && !index.bibFiles.includes(resolved)) {
        index.bibFiles.push(resolved);
      }
    }
  }
  index.bibFiles.sort();

  // Figure reconciliation: try exact, then extensionless, then common exts
  const normalize = (f: string): string[] => {
    const base = f.replace(/^\.\/|^figures\//, "");
    const inFigures = `figures/${f.replace(/^\.?\//, "")}`;
    const out = [f, base, inFigures];
    for (const v of [f, base, inFigures]) {
      if (!IMAGE_EXT.test(v)) {
        for (const ext of [".png", ".pdf", ".jpg", ".eps"]) {
          out.push(`${v}${ext}`);
        }
      }
    }
    return out;
  };
  const matched = new Set<string>();
  for (const ref of figureRefs) {
    const hit = normalize(ref).find((c) => onDisk.has(c));
    if (hit) matched.add(hit);
    else index.missingFigures.push(ref);
  }
  index.orphanedFigures = [...onDisk].filter(
    (f) => IMAGE_EXT.test(f) && !matched.has(f),
  );
  index.referencedFigures = [...figureRefs].sort();
  index.figuresOnDisk = index.figuresOnDisk; // already sorted

  // Label/missing reconciliation
  index.labels = Object.fromEntries([...labels.entries()].sort());
  index.refs = refs;
  const labelKeys = new Set(labels.keys());
  index.missingLabels = [...new Set(refs.map((r) => r.key))]
    .filter((k) => !labelKeys.has(k))
    .sort();

  // Citation reconciliation
  index.citations = citations;
  index.missingCitations = [
    ...new Set(citations.map((c) => c.key)),
  ]
    .filter((k) => !bibKeys.has(k))
    .sort();

  index.packages = [...packages].sort();
  index.engineHints = [...engineHints];
  index.sections = sections;
  index.entryFile = entryFile;

  return index;
}

/** Compact human/LLM-readable summary of an index. */
export function summarizeIndex(idx: ProjectIndex): string {
  const lines: string[] = [];
  lines.push(`entry: ${idx.entryFile ?? "(none found)"}`);
  const otherTex = texFileCount(idx.inputGraph);
  lines.push(`tex files: ${otherTex}`);
  lines.push(`bib files: ${idx.bibFiles.join(", ") || "(none)"}`);
  lines.push(`packages: ${idx.packages.join(", ") || "(none)"}`);
  if (idx.engineHints.length)
    lines.push(`engine hints: ${idx.engineHints.join(", ")}`);
  lines.push(
    `figures: ${idx.figuresOnDisk.length} on disk, ${idx.referencedFigures.length} referenced`,
  );
  if (idx.missingFigures.length)
    lines.push(`MISSING FIGURES: ${idx.missingFigures.join(", ")}`);
  if (idx.orphanedFigures.length)
    lines.push(`orphaned figures (on disk, never referenced): ${idx.orphanedFigures.join(", ")}`);
  lines.push(`labels: ${Object.keys(idx.labels).length} defined, ${idx.refs.length} refs`);
  if (idx.missingLabels.length)
    lines.push(`MISSING LABELS (\\ref without \\label): ${idx.missingLabels.join(", ")}`);
  lines.push(`citations: ${idx.citations.length} \\cite calls`);
  if (idx.missingCitations.length)
    lines.push(`MISSING CITATIONS (\\cite without bib entry): ${idx.missingCitations.join(", ")}`);
  lines.push(`sections: ${idx.sections.map((s) => s.title).join(" → ")}`);
  return lines.join("\n");
}

function texFileCount(inputGraph: Record<string, string[]>): number {
  const set = new Set(Object.keys(inputGraph));
  for (const targets of Object.values(inputGraph)) {
    for (const t of targets) if (TEX_EXT.test(t)) set.add(t);
  }
  return set.size;
}

// Re-export for callers that already have FileTreeNode[]
export type { FileTreeNode };
