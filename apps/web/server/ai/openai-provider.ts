import type { AIProvider, ChatMessage, ProviderResponse, ProviderStreamEvent } from "./types";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "propose_patch",
      description: "Propose an edit to the user's document. Never write files directly.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
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
        required: ["summary", "operations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file_range",
      description: "Read a line range from a project file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
        },
        required: ["path", "startLine", "endLine"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_compile_errors",
      description: "Get diagnostics from the most recent compile",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_project_files",
      description:
        "List all files in the project with their paths and sizes. Use to check whether a referenced figure/file exists.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_structure",
      description: "Get the project file tree (directories + files) as an indented outline.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_index",
      description:
        "ONE-SHOT structural analysis of the project — call this FIRST before reading files. Returns: entry file, \\input graph, packages + engine hints, figure reconciliation (referenced vs orphaned vs missing), label/ref reconciliation (missing \\label for \\ref), citation reconciliation (\\cite keys missing from .bib), section outline. Prefer this over list_project_files + multiple read_file_range rounds.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "check_figure_paths",
      description:
        "Cross-check every \\includegraphics target in .tex files against actual project files. Returns OK/MISSING per reference plus orphaned figures. Use when a compile fails with 'File not found' for figures. For broader structural info use get_project_index.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "request_compile",
      description:
        "Trigger a fresh LaTeX compile of the project and wait for the result (up to 45s). Returns status + error summary. Use AFTER applying patches to verify they compile.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_literature",
      description:
        "Search free academic databases (PubMed, Europe PMC, OpenAlex, Crossref) for real papers. Returns titles, authors, venues, DOIs, citation counts and BibTeX. Use to verify or find citations — NEVER invent references when this tool is available.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query, e.g. 'CAR-T cytokine release syndrome management'",
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
  },
  {
    type: "function",
    function: {
      name: "get_pubmed_abstract",
      description:
        "Fetch the full abstract of a PubMed article by PMID. Use after search_literature when you need more detail about a specific paper before citing it.",
      parameters: {
        type: "object",
        properties: {
          pmid: { type: "string", description: "PubMed ID, e.g. '42726800'" },
        },
        required: ["pmid"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "General web search (Tavily) for non-scholarly information: journal submission requirements, conference deadlines, software docs, terminology conventions. For finding papers, prefer search_literature. Returns titles, URLs and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Web search query" },
          limit: { type: "number", description: "Max results (1-10, default 5)" },
        },
        required: ["query"],
      },
    },
  },
];

export class OpenAIProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  ) {}

  async chat(opts: {
    messages: ChatMessage[];
    onStream?: (token: string) => void;
  }): Promise<ProviderResponse> {
    if (opts.onStream) {
      let content = "";
      const toolCalls: ProviderResponse["toolCalls"] = [];
      for await (const ev of this.streamChat({ messages: opts.messages })) {
        if (ev.type === "token") {
          content += ev.content;
          opts.onStream(ev.content);
        } else if (ev.type === "tool_call") {
          toolCalls.push({ id: `tc-${toolCalls.length}`, name: ev.name, args: ev.args });
        }
      }
      return { content, toolCalls };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: opts.messages,
        tools: TOOLS,
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    const msg = data.choices?.[0]?.message;
    const toolCalls = (msg?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: safeJson(tc.function.arguments) as Record<string, unknown>,
    }));
    return { content: msg?.content || "", toolCalls };
  }

  async *streamChat(opts: { messages: ChatMessage[] }): AsyncGenerator<ProviderStreamEvent> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: opts.messages,
        tools: TOOLS,
        temperature: 0.3,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      yield { type: "token", content: `\n[OpenAI error ${res.status}] ${body.slice(0, 200)}` };
      yield { type: "done" };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let toolBuf: Record<number, { name: string; args: string }> = {};

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
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index: number;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) yield { type: "token", content: delta.content };
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const cur = toolBuf[tc.index] || { name: "", args: "" };
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.args += tc.function.arguments;
              toolBuf[tc.index] = cur;
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
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
