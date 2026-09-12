import { z } from "zod";
import { requireUser, handleApiError } from "@/server/session";
import {
  getPublicAiConfig,
  saveUserAiConfig,
  clearUserAiConfig,
} from "@/server/ai/config";
import { buildProvider } from "@/server/ai/index";

const SaveBody = z.object({
  provider: z.enum(["mock", "openai", "anthropic"]),
  baseUrl: z.string().url().or(z.literal("")).optional(),
  model: z.string().max(120).optional(),
  apiKey: z.string().max(400).optional(),
  clearKey: z.boolean().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const config = await getPublicAiConfig(user.id);
    return Response.json({ config });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = SaveBody.parse(await req.json());
    if (body.clearKey) {
      const config = await clearUserAiConfig(user.id);
      return Response.json({ config });
    }
    const config = await saveUserAiConfig(user.id, {
      provider: body.provider,
      baseUrl: body.baseUrl || undefined,
      model: body.model || undefined,
      apiKey: body.apiKey || undefined,
    });
    return Response.json({ config });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.errors[0]?.message }, { status: 400 });
    }
    return handleApiError(err);
  }
}

/** Lightweight connectivity test — does not return the key */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = SaveBody.partial().parse(await req.json());
    // Test with provided or saved config
    const { getProviderForUser } = await import("@/server/ai/config");
    let provider;
    if (body.apiKey || body.provider) {
      provider = buildProvider({
        provider: body.provider || "openai",
        baseUrl: body.baseUrl || "https://api.openai.com/v1",
        model: body.model || "gpt-4o-mini",
        apiKey: body.apiKey || "",
      });
    } else {
      const loaded = await getProviderForUser(user.id);
      provider = loaded.provider;
      if (loaded.config.provider === "mock") {
        return Response.json({ ok: true, provider: "mock", message: "Mock provider always available" });
      }
    }

    const res = await provider.chat({
      messages: [
        { role: "system", content: "Reply with the single word: ok" },
        { role: "user", content: "ping" },
      ],
    });
    return Response.json({
      ok: true,
      preview: (res.content || "").slice(0, 80),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg.slice(0, 300) }, { status: 502 });
  }
}
