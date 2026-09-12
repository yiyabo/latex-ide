import { requireUser, handleApiError } from "@/server/session";
import { acceptPatch } from "@/server/ai/agent";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const result = await acceptPatch(params.id, user.id);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
