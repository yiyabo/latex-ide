import { requireUser, handleApiError } from "@/server/session";
import { rejectPatch } from "@/server/ai/agent";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const result = await rejectPatch(params.id, user.id);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
