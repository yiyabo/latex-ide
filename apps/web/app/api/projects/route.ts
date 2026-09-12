import { z } from "zod";
import { requireUser, handleApiError } from "@/server/session";
import { db } from "@/server/db";
import { createProjectFromTemplate } from "@/server/files";
import { isTemplateName } from "@/server/templates";

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  template: z.string().default("paper"),
});

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await db.project.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
    });
    return Response.json({ projects });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = CreateBody.parse(await req.json());
    const template = isTemplateName(body.template) ? body.template : "paper";
    const project = await createProjectFromTemplate(user.id, body.name, template);
    return Response.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.errors[0]?.message }, { status: 400 });
    }
    return handleApiError(err);
  }
}
