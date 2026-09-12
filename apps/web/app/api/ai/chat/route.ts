import { z } from "zod";
import { requireUser, requireProject, handleApiError } from "@/server/session";
import { runChat, listConversations } from "@/server/ai/agent";
import { EditorSelectionContextSchema } from "@latex-ide/contracts";

const Body = z.object({
  conversationId: z.string().nullish(),
  projectId: z.string(),
  message: z.string().min(1),
  selection: EditorSelectionContextSchema.nullish(),
  action: z.string().nullish(),
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return handleApiError(err);
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return handleApiError(err);
  }

  try {
    await requireProject(body.projectId, user.id);
  } catch (err) {
    return handleApiError(err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        await runChat({
          projectId: body.projectId,
          userId: user.id,
          message: body.message,
          selection: body.selection ?? null,
          action: body.action ?? undefined,
          conversationId: body.conversationId ?? undefined,
          onEvent: send,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
    await requireProject(projectId, user.id);
    const conversations = await listConversations(projectId);
    return Response.json({ conversations });
  } catch (err) {
    return handleApiError(err);
  }
}
