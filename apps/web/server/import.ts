import { unzipSync, strFromU8 } from "fflate";
import { createHash } from "node:crypto";
import { db } from "./db";
import { getStorage, newVersionId } from "./storage";
import { assertSafePath } from "./path";
import { BadRequestError } from "./session";

const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50 MB compressed
const MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024; // 200 MB
const MAX_FILES = 500;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB per file

// Text formats that become editable project files
const TEXT_EXT = new Set([
  ".tex", ".bib", ".cls", ".sty", ".bst", ".txt", ".md",
]);
// Binary formats allowed as assets (figures etc.)
const BIN_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".pdf", ".svg", ".eps", ".gif", ".tif", ".tiff",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

/** Common archive scaffolding to ignore */
function isJunkPath(p: string): boolean {
  const parts = p.split("/");
  return parts.some(
    (seg) =>
      seg === "__MACOSX" ||
      seg === ".DS_Store" ||
      seg.startsWith("._") ||
      seg === ".git" ||
      seg === ".gitignore" ||
      seg === ".vscode" ||
      seg === ".idea",
  );
}

/**
 * Strip a single redundant top-level folder (e.g. "my-paper/main.tex" →
 * "main.tex") so zips exported from Overleaf/OSF import cleanly.
 */
function stripCommonRoot(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const paths = [...files.keys()];
  if (paths.length < 2) return files;
  const first = paths[0]!;
  const root = first.split("/")[0];
  if (!root) return files;
  // All entries must share the same root and it must not be a file at root level
  const allShareRoot = paths.every((p) => p.startsWith(`${root}/`));
  if (!allShareRoot) return files;
  const out = new Map<string, Uint8Array>();
  for (const [p, data] of files) {
    out.set(p.slice(root.length + 1), data);
  }
  return out;
}

export type ImportedFile = { path: string; isBinary: boolean; size: number };

export type ImportResult = {
  projectId: string;
  files: ImportedFile[];
  entryFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
  skipped: string[];
};

export type ImportInputFile = { path: string; data: Buffer };

/**
 * Import core. `rootHint` is the folder name when importing a folder —
 * when every file sits directly under that root (no subdirs), we keep the
 * files at the project root but PRESERVE subdirectory structure for the rest.
 */
async function importFileTree(
  ownerId: string,
  projectName: string,
  raw: Map<string, Uint8Array>,
): Promise<ImportResult> {
  let skipped: string[] = [];

  // Pre-filter: sizes, junk, path safety (before root-strip so names are original)
  const cleaned = new Map<string, Uint8Array>();
  let totalSize = 0;
  for (const [name, data] of raw) {
    if (isJunkPath(name)) continue;
    try {
      assertSafePath(name);
    } catch {
      skipped.push(`${name} (unsafe path)`);
      continue;
    }
    if (data.length > MAX_FILE_SIZE) {
      skipped.push(`${name} (file too large)`);
      continue;
    }
    totalSize += data.length;
    if (totalSize > MAX_TOTAL_UNCOMPRESSED) {
      throw new BadRequestError("Import too large (max 200 MB uncompressed)");
    }
    cleaned.set(name, data);
  }

  if (cleaned.size === 0) {
    throw new BadRequestError("Nothing usable found in the import");
  }
  if (cleaned.size > MAX_FILES) {
    throw new BadRequestError(`Too many files (max ${MAX_FILES})`);
  }

  // Normalize: strip common root folder, filter by extension
  const normalized = stripCommonRoot(cleaned);
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of normalized) {
    try {
      assertSafePath(name);
    } catch {
      skipped.push(`${name} (unsafe path)`);
      continue;
    }
    const ext = extOf(name);
    const isText = TEXT_EXT.has(ext);
    const isBin = BIN_EXT.has(ext);
    if (!isText && !isBin) {
      skipped.push(`${name} (unsupported type)`);
      continue;
    }
    // Text files must not contain NUL bytes (catches mislabeled binaries)
    if (isText && data.length > 0) {
      const probe = data.subarray(0, 4096);
      if (probe.includes(0)) {
        skipped.push(`${name} (binary content in text file)`);
        continue;
      }
    }
    files.set(name, data);
  }

  if (files.size === 0) {
    throw new BadRequestError(
      "No .tex/.bib/figure files found. Export the project (not a single PDF) and try again.",
    );
  }

  // ---- entry detection: .tex containing \documentclass, shortest path wins
  let entryFile = "";
  let engine: ImportResult["engine"] = "pdflatex";
  const texCandidates: Array<{ path: string; content: string }> = [];
  for (const [name, data] of files) {
    if (extOf(name) !== ".tex") continue;
    const content = strFromU8(data);
    texCandidates.push({ path: name, content });
    if (/\\documentclass/.test(content)) {
      if (!entryFile || name.split("/").length < entryFile.split("/").length) {
        entryFile = name;
      }
      if (/\\usepackage\{fontspec\}|\\usepackage\[.*\]\{fontspec\}|xeCJK/.test(content)) {
        engine = "xelatex";
      }
    }
  }
  if (!entryFile) {
    // fall back: first .tex alphabetically
    const texes = texCandidates.map((t) => t.path).sort();
    entryFile = texes[0] ?? "main.tex";
  }

  const project = await db.project.create({
    data: {
      ownerId,
      name: projectName,
      entryFile,
      engine,
    },
  });

  // ---- write all files
  const storage = getStorage();
  const imported: ImportedFile[] = [];
  for (const [name, data] of files) {
    const safe = assertSafePath(name);
    const isBinary = BIN_EXT.has(extOf(name));
    const hash = createHash("sha256").update(data).digest("hex");
    const versionId = newVersionId();
    const key = `projects/${project.id}/${safe
      .split("/")
      .map(encodeURIComponent)
      .join("/")}#${versionId}`;
    await storage.put(key, Buffer.from(data));

    await db.projectFile.create({
      data: {
        projectId: project.id,
        path: safe,
        isBinary,
        size: data.length,
      },
    });
    await db.fileVersion.create({
      data: {
        projectId: project.id,
        path: safe,
        contentHash: hash,
        storageKey: key,
        createdBy: ownerId,
      },
    });
    imported.push({ path: safe, isBinary, size: data.length });
  }

  return {
    projectId: project.id,
    files: imported,
    entryFile,
    engine,
    skipped,
  };
}

/** Import a .zip archive (Overleaf export, OSF, etc.) */
export async function importProjectFromZip(
  ownerId: string,
  projectName: string,
  zipData: Buffer,
): Promise<ImportResult> {
  if (zipData.length > MAX_ZIP_SIZE) {
    throw new BadRequestError(`Zip too large (max ${MAX_ZIP_SIZE / 1024 / 1024} MB)`);
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(zipData));
  } catch {
    throw new BadRequestError("Invalid zip archive");
  }

  const raw = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue; // directory entry
    raw.set(name, data);
  }
  if (raw.size === 0) {
    throw new BadRequestError("Archive contains no usable files");
  }

  return importFileTree(ownerId, projectName, raw);
}

/** Import a folder uploaded as individual files with relative paths */
export async function importProjectFromFiles(
  ownerId: string,
  projectName: string,
  files: ImportInputFile[],
): Promise<ImportResult> {
  const raw = new Map<string, Uint8Array>();
  for (const f of files) {
    raw.set(f.path, new Uint8Array(f.data));
  }
  return importFileTree(ownerId, projectName, raw);
}
