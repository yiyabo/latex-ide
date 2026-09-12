import { requireUser, requireProject, handleApiError } from "@/server/session";
import { listFiles, buildTree } from "@/server/files";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProject(params.id, user.id);
    const files = await listFiles(params.id);
    const tree = buildTree(files);
    return Response.json({ tree, files });
  } catch (err) {
    return handleApiError(err);
  }
}
