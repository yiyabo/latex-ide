import { z } from "zod";
import { requireUser, requireProject, handleApiError } from "@/server/session";
import { enqueueCompile } from "@/server/compile";

const Body = z.object({
  entryFile: z.string().optional(),
  engine: z.enum(["pdflatex", "xelatex", "lualatex"]).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const project = await requireProject(params.id, user.id);
    const body = Body.parse(await req.json().catch(() => ({})));
    const jobId = await enqueueCompile(
      project.id,
      body.entryFile || project.entryFile,
      body.engine || (project.engine as "pdflatex") || "pdflatex",
    );
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    return handleApiError(err);
  }
}
