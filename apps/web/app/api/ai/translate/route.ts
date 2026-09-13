import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { OpenAIProvider } from "@/server/ai/openai-provider";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are an academic translation assistant. Translate English scholarly text (from LaTeX papers) into Chinese.

Rules:
- Output ONLY the Chinese translation — no preamble, no explanations, no quotes.
- Preserve technical terms, gene names, protein family names (e.g. CHAP, Glyco_hydro_25, LysK-like), citations like [12], and numbers exactly as in the source.
- Use standard academic Chinese phrasing (学术中文), matching the tone of a review article.
- If the text is a table fragment, translate cell text but keep the tabular line structure.
- If the text is already Chinese or contains no translatable English, return it unchanged.`;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { text?: string };
    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json({ error: "text too long (max 4000 chars)" }, { status: 400 });
    }

    void user;
    const keyPath = path.join(
      process.env.HOME || "/Users/Shared",
      "Library/Application Support/com.yiyabo.desktop/deepseek.key",
    );
    const apiKey = (await readFile(keyPath, "utf8")).trim();
    if (!apiKey) throw new Error("DeepSeek translation key is empty");

    const endpoint = "https://api.deepseek.com/v1";
    const provider = new OpenAIProvider(apiKey, "deepseek-flash", endpoint);
    const res = await provider.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    });

    return NextResponse.json({ translation: res.content || text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
