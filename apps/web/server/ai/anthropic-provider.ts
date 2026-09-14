import type {
  AIProvider,
  ChatMessage,
  ProviderResponse,
  ProviderStreamEvent,
} from "./types";

const TOOLS = [
  {
    name: "propose_patch",
    description:
      "Propose an edit to the user's document. Never write files directly.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        filePath: { type: "string", description: "Exact project-relative file path to edit" },
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["replace"] },
              expectedOldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["type", "expectedOldText", "newText"],
          },
        },
      },
      required: ["summary", "filePath", "operations"],
    },
  },
  {
    name: "read_file_range",
    description: "Read a line range from a project file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
      },
      required: ["path", "startLine", "endLine"],
    },
  },
  {
    name: "get_compile_errors",
    description: "Get diagnostics from the most recent compile. Set request to the user's explicit request when deciding whether to include layout warnings.",
    input_schema: {
      type: "object",
      properties: { request: { type: "string", description: "The user's request, especially if they ask to fix warnings or layout." } },
    },
  },
  {
    name: "list_project_files",
    description:
      "List all files in the project with their paths and sizes. Use to check whether a referenced figure/file exists.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_project_structure",
    description: "Get the project file tree (directories + files) as an indented outline.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_project_index",
    description:
      "ONE-SHOT structural analysis of the project — call this FIRST before reading files. Returns: entry file, \\input graph, packages + engine hints, figure reconciliation (referenced vs orphaned vs missing), label/ref reconciliation (missing \\label for \\ref), citation reconciliation (\\cite keys missing from .bib), section outline. Prefer this over list_project_files + multiple read_file_range rounds.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_figure_paths",
    description:
      "Cross-check every \\includegraphics target in .tex files against actual project files. Returns OK/MISSING per reference plus orphaned figures. Use when a compile fails with 'File not found' for figures. For broader structural info use get_project_index.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "request_compile",
    description:
      "Trigger a fresh LaTeX compile of the project and wait for the result (up to 45s). Returns status + error summary. Use AFTER applying patches to verify they compile.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_literature",
    description:
      "Search free academic databases (PubMed, Europe PMC, OpenAlex, Crossref) for real papers. Returns titles, authors, venues, DOIs, citation counts and BibTeX. Use to verify or find citations — NEVER invent references when this tool is available.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query, e.g. 'CAR-T cytokine release syndrome management'",
        },
        source: {
          type: "string",
          enum: ["all", "pubmed", "europepmc", "openalex", "crossref"],
          description:
            "Which source to search. 'all' queries every database in parallel. Biomedical topics: pubmed or europepmc. Broad/CS/other fields: openalex or crossref.",
        },
        limit: { type: "number", description: "Max results (1-10, default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_pubmed_abstract",
    description:
      "Fetch the full abstract of a PubMed article by PMID. Use after search_literature when you need more detail about a specific paper before citing it.",
    input_schema: {
      type: "object",
      properties: {
        pmid: { type: "string", description: "PubMed ID, e.g. '42726800'" },
      },
      required: ["pmid"],
    },
  },
  {
    name: "web_search",
    description:
      "General web search (Tavily) for non-scholarly information: journal submission requirements, conference deadlines, software docs, terminology conventions. For finding papers, prefer search_literature. Returns titles, URLs and snippets.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Web search query" },
        limit: { type: "number", description: "Max results (1-10, default 5)" },
      },
      required: ["query"],
    },
  },
];

/**
 * Anthropic Messages API provider.
 * Base URL defaults to https://api.anthropic.com
 * Compatible with proxies that expose /v1/messages.
 */
export class AnthropicProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
  ) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  private splitMessages(messages: ChatMessage[]): {
    system: string;
    rest: Array<{ role: "user" | "assistant"; content: unknown }>;
  } {
    const systemParts: string[] = [];
    const rest: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    for (const m of messages) {
      if (m.role === "system") systemParts.push(m.content);
      else if (m.role === "user" || m.role === "assistant") {
        rest.push({ role: m.role, content: m.content });
      }
      // tool messages are folded into next user turn by caller if needed
    }
    return { system: systemParts.join("\n\n"), rest };
  }

  async chat(opts: {
    messages: ChatMessage[];
    onStream?: (token: string) => void;
    toolChoice?: string;
  }): Promise<ProviderResponse> {
    if (opts.onStream) {
      let content = "";
      const toolCalls: ProviderResponse["toolCalls"] = [];
      for await (const ev of this.streamChat({ messages: opts.messages, toolChoice: opts.toolChoice })) {
        if (ev.type === "token") {
          content += ev.content;
          opts.onStream(ev.content);
        } else if (ev.type === "tool_call") {
          toolCalls.push({
            id: `tc-${toolCalls.length}`,
            name: ev.name,
            args: ev.args,
          });
        }
      }
      return { content, toolCalls };
    }

    const { system, rest } = this.splitMessages(opts.messages);
    const res = await fetch(`${this.base()}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: rest,
        tools: TOOLS,
        ...(opts.toolChoice ? { tool_choice: { type: "tool", name: opts.toolChoice } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      content?: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      >;
    };
    let content = "";
    const toolCalls: ProviderResponse["toolCalls"] = [];
    for (const block of data.content || []) {
      if (block.type === "text") content += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: (block.input || {}) as Record<string, unknown>,
        });
      }
    }
    return { content, toolCalls };
  }

  async *streamChat(opts: {
    messages: ChatMessage[];
    toolChoice?: string;
  }): AsyncGenerator<ProviderStreamEvent> {
    const { system, rest } = this.splitMessages(opts.messages);
    const res = await fetch(`${this.base()}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        stream: true,
        system,
        messages: rest,
        tools: TOOLS,
        ...(opts.toolChoice ? { tool_choice: { type: "tool", name: opts.toolChoice } } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      yield {
        type: "token",
        content: `\n[Anthropic error ${res.status}] ${body.slice(0, 200)}`,
      };
      yield { type: "done" };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const toolBuf: Record<
      number,
      { name: string; args: string; id: string }
    > = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            type?: string;
            index?: number;
            delta?: {
              type?: string;
              text?: string;
              partial_json?: string;
              name?: string;
            };
            content_block?: {
              type?: string;
              id?: string;
              name?: string;
              index?: number;
            };
          };

          if (json.type === "content_block_delta") {
            const delta = json.delta;
            if (delta?.type === "text_delta" && delta.text) {
              yield { type: "token", content: delta.text };
            }
            if (delta?.type === "input_json_delta" && delta.partial_json != null) {
              const idx = json.index ?? 0;
              const cur = toolBuf[idx] || { name: "", args: "", id: "" };
              cur.args += delta.partial_json;
              toolBuf[idx] = cur;
            }
          }
          if (json.type === "content_block_start") {
            const block = json.content_block;
            if (block?.type === "tool_use") {
              const idx = json.index ?? 0;
              toolBuf[idx] = {
                name: block.name || "",
                args: "",
                id: block.id || "",
              };
            }
          }
        } catch {
          /* skip malformed SSE */
        }
      }
    }

    for (const tc of Object.values(toolBuf)) {
      yield {
        type: "tool_call",
        name: tc.name,
        args: safeJson(tc.args) as Record<string, unknown>,
      };
    }
    yield { type: "done" };
  }

  private base(): string {
    return this.baseUrl.replace(/\/$/, "");
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
