export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ProviderResponse = {
  content: string;
  toolCalls: ToolCall[];
};

export type ProviderStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "done" };

export interface AIProvider {
  chat(opts: {
    messages: ChatMessage[];
    onStream?: (token: string) => void;
  }): Promise<ProviderResponse>;
  streamChat(opts: { messages: ChatMessage[] }): AsyncGenerator<ProviderStreamEvent>;
}
