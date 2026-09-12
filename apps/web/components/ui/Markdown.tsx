"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight markdown renderer for AI chat bubbles.
 * Supports: **bold**, *italic*, `code`, ```blocks```, - lists, ### headings, paragraphs.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className={cn("space-y-2", className)}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

type Block =
  | { type: "code"; lang: string; code: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "p"; text: string };

function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", lang, code: buf.join("\n") });
      continue;
    }

    // hr
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ type: "heading", level: h[1]!.length, text: h[2]!.trim() });
      i++;
      continue;
    }

    // GFM table: header row | delimiter row | data rows...
    if (
      line.includes("|") &&
      /^\s*\|?.+\|/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1] ?? "")
    ) {
      const parseRow = (l: string): string[] =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const header = parseRow(line);
      i += 2; // skip header + delimiter
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim()) {
        rows.push(parseRow(lines[i] ?? ""));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // blockquote
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        buf.push((lines[i] ?? "").slice(2));
        i++;
      }
      blocks.push({ type: "quote", text: buf.join("\n") });
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items, ordered: false });
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items, ordered: true });
      continue;
    }

    // blank
    if (!line.trim()) {
      i++;
      continue;
    }

    // paragraph (consume until blank or new block type)
    const buf: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (
        !l.trim() ||
        /^```/.test(l) ||
        /^#{1,6}\s/.test(l) ||
        /^\s*[-*+]\s+/.test(l) ||
        /^\s*\d+\.\s+/.test(l) ||
        l.startsWith("> ") ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)
      ) {
        break;
      }
      buf.push(l);
      i++;
    }
    blocks.push({ type: "p", text: buf.join("\n") });
  }

  return blocks;
}

function Block({ block }: { block: Block }) {
  if (block.type === "code") {
    return (
      <div className="group relative">
        {block.lang && (
          <div className="rounded-t-md border border-b-0 border-border bg-elevated px-2 py-0.5 font-mono text-2xs text-muted">
            {block.lang}
          </div>
        )}
        <pre
          className={cn(
            "thin-scroll overflow-x-auto border border-border bg-bg px-3 py-2 font-mono text-2xs leading-relaxed",
            block.lang ? "rounded-b-md" : "rounded-md",
          )}
        >
          <code>{block.code}</code>
        </pre>
        <CopyButton text={block.code} />
      </div>
    );
  }

  if (block.type === "heading") {
    const Tag = (block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5") as
      | "h3"
      | "h4"
      | "h5";
    return (
      <Tag
        className={cn(
          "font-semibold tracking-tight",
          block.level <= 2 ? "text-[13px]" : "text-xs",
        )}
      >
        <Inline text={block.text} />
      </Tag>
    );
  }

  if (block.type === "table") {
    return (
      <div className="thin-scroll overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-2xs">
          <thead>
            <tr className="bg-elevated">
              {block.header.map((c, j) => (
                <th
                  key={j}
                  className="border-b border-border px-2 py-1.5 text-left font-semibold text-ink"
                >
                  <Inline text={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="odd:bg-accent-soft/20">
                {row.map((c, j) => (
                  <td key={j} className="border-b border-border/60 px-2 py-1 align-top text-muted">
                    <Inline text={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "hr") {
    return <hr className="border-border" />;
  }

  if (block.type === "quote") {
    return (
      <blockquote className="border-l-2 border-accent/50 pl-2 text-muted italic">
        <Inline text={block.text} />
      </blockquote>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag
        className={cn(
          "list-outside space-y-1 pl-4",
          block.ordered ? "list-decimal" : "list-disc",
        )}
      >
        {block.items.map((item, i) => (
          <li key={i} className="pl-0.5">
            <Inline text={item} />
          </li>
        ))}
      </ListTag>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words">
      <Inline text={block.text} />
    </p>
  );
}

/** Inline: **bold**, *italic*, `code`, ~~strike~~ */
function Inline({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  // tokenise with a single pass regex
  const re =
    /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~]+~~|__[^_]+__)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("~~")) {
      nodes.push(
        <s key={key++} className="text-muted">
          {tok.slice(2, -2)}
        </s>,
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-elevated px-1 py-0.5 font-mono text-2xs text-accent"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <em key={key++} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <Fragment>{nodes}</Fragment>;
}

function CopyButton({ text }: { text: string }) {
  return (
    <button
      onClick={() => void navigator.clipboard.writeText(text)}
      className="absolute right-1 top-1 rounded bg-elevated/80 px-1.5 py-0.5 text-2xs text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
      title="Copy"
    >
      Copy
    </button>
  );
}
