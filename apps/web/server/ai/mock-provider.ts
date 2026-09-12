import type { ChatMessage, ProviderResponse, ProviderStreamEvent } from "./types";

/**
 * Deterministic mock provider for demos & tests.
 * Produces a short explanation plus a patch-like rewrite of the selection.
 */
export class MockProvider {
  async chat(opts: {
    messages: ChatMessage[];
    onStream?: (t: string) => void;
  }): Promise<ProviderResponse> {
    const user = [...opts.messages].reverse().find((m) => m.role === "user");
    const text = user?.content || "";
    const selected = extractSelected(text);

    const reply = selected
      ? `Here is a revised version of the selected passage.\n\nI tightened the wording while preserving the technical claims. Review the diff before accepting.`
      : `I can help revise the selected LaTeX. Select a passage in the editor, then choose an action.`;

    // stream
    if (opts.onStream) {
      for (const ch of reply.split(/(?<=\s)/)) {
        opts.onStream(ch);
      }
    }

    return {
      content: reply,
      toolCalls: selected
        ? [
            {
              id: "mock-1",
              name: "propose_patch",
              args: {
                summary: "Polish selection for clarity",
                operations: [
                  {
                    type: "replace",
                    // filled by caller from selection offsets
                    expectedOldText: selected,
                    newText: mockRewrite(selected),
                  },
                ],
              },
            },
          ]
        : [],
    };
  }

  async *streamChat(opts: { messages: ChatMessage[] }): AsyncGenerator<ProviderStreamEvent> {
    const res = await this.chat({ messages: opts.messages });
    for (const ch of res.content.split(/(?<=\s)/)) {
      yield { type: "token", content: ch };
    }
    for (const tc of res.toolCalls) {
      yield { type: "tool_call", name: tc.name, args: tc.args };
    }
    yield { type: "done" };
  }
}

function extractSelected(userText: string): string | null {
  const m = userText.match(/SELECTED TEXT:\n([\s\S]*?)\n\n/);
  return m?.[1] ?? null;
}

function mockRewrite(text: string): string {
  // Light deterministic rewrite: trim filler, keep meaning
  let t = text.trim();
  t = t.replace(/\bvery\s+/gi, "");
  t = t.replace(/\breally\s+/gi, "");
  t = t.replace(/\bin order to\b/gi, "to");
  t = t.replace(/\bdue to the fact that\b/gi, "because");
  t = t.replace(/\butilize\b/gi, "use");
  t = t.replace(/\s{2,}/g, " ");
  if (t === text.trim()) {
    // Ensure a visible diff for demo
    t = t.replace(/\.$/, ".") + " (revised)";
    if (t === text.trim() + " (revised)") return t;
    return `${t}`;
  }
  return t;
}
