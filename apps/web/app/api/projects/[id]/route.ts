import { z } from "zod";
import { requireUser, requireProject, handleApiError, NotFoundError } from "@/server/session";
import { db } from "@/server/db";

const PatchBody = z.object({ name: z.string().trim().min(1).max(120).optional() });

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const project = await requireProject(params.id, user.id);
    return Response.json({ project });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProject(params.id, user.id);
    const body = PatchBody.parse(await req.json());
    const project = await db.project.update({
      where: { id: params.id },
      data: { ...(body.name ? { name: body.name } : {}) },
    });
    return Response.json({ project });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProject(params.id, user.id);
    await db.project.delete({ where: { id: params.id } });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return handleApiError(err);
    return handleApiError(err);
  }
}
