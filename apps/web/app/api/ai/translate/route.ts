import { NextResponse } from "next/server";
import { getAIProvider } from "@/server/ai";
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
    await requireUser();
    const body = (await req.json()) as { text?: string };
    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json({ error: "text too long (max 4000 chars)" }, { status: 400 });
    }

    const provider = getAIProvider();
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
