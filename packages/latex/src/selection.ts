import type { EditorSelectionContext } from "@latex-ide/contracts";

const SECTION_COMMANDS = [
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
] as const;

const SECTION_RE = new RegExp(
  String.raw`\\(${SECTION_COMMANDS.join("|")})(?:\[[^\]]*\])?\{([^}]*)\}`,
  "g",
);

export function detectLanguage(filePath: string): "tex" | "bib" {
  if (filePath.toLowerCase().endsWith(".bib")) return "bib";
  return "tex";
}

/** Walk backwards from offset to collect nested section path. */
export function extractSectionPath(text: string, offset: number): string[] {
  const before = text.slice(0, offset);
  const stack: Array<{ level: number; title: string }> = [];

  SECTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_RE.exec(before)) !== null) {
    const cmd = match[1] ?? "section";
    const title = (match[2] ?? "").trim();
    const level = SECTION_COMMANDS.indexOf(
      cmd as (typeof SECTION_COMMANDS)[number],
    );
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
      stack.pop();
    }
    stack.push({ level, title });
  }

  return stack.map((s) => s.title).filter(Boolean);
}

export function lineOfOffset(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function offsetOfLine(text: string, line: number): number {
  if (line <= 1) return 0;
  let current = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      current++;
      if (current === line) return i + 1;
    }
  }
  return text.length;
}

export function extractSurroundingText(
  text: string,
  start: number,
  end: number,
  radius = 20,
): string {
  const startLine = lineOfOffset(text, start);
  const endLine = lineOfOffset(text, end);
  const fromLine = Math.max(1, startLine - radius);
  const toLine = endLine + radius;
  const from = offsetOfLine(text, fromLine);
  const to = offsetOfLine(text, toLine + 1);
  return text.slice(from, Math.min(to, text.length));
}

export type BuildSelectionInput = {
  projectId: string;
  filePath: string;
  documentText: string;
  selectionStart: number;
  selectionEnd: number;
  surroundingRadius?: number;
};

export function buildSelectionContext(
  input: BuildSelectionInput,
): EditorSelectionContext | null {
  const {
    projectId,
    filePath,
    documentText,
    selectionStart,
    selectionEnd,
    surroundingRadius = 20,
  } = input;

  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  if (start === end) return null;
  if (start < 0 || end > documentText.length) return null;

  return {
    projectId,
    filePath,
    selectionStart: start,
    selectionEnd: end,
    selectedText: documentText.slice(start, end),
    surroundingText: extractSurroundingText(
      documentText,
      start,
      end,
      surroundingRadius,
    ),
    sectionPath: extractSectionPath(documentText, start),
    cursorLine: lineOfOffset(documentText, end),
    language: detectLanguage(filePath),
  };
}
