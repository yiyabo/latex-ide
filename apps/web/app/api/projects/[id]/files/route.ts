import { z } from "zod";
import { requireUser, requireProject, handleApiError, BadRequestError } from "@/server/session";
import {
  readFileContent,
  writeFileContent,
  deleteFile,
  renameFile,
} from "@/server/files";

const PutBody = z.object({
  content: z.string(),
  clientVersion: z.string().optional(),
});

const RenameBody = z.object({ newPath: z.string().min(1).max(255) });

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProject(params.id, user.id);
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) throw new BadRequestError("path query required");
    const { meta, latest, content } = await readFileContent(params.id, path);
    return Response.json({
      path: meta.path,
      content,
      versionId: latest.id,
      contentHash: latest.contentHash,
      updatedAt: meta.updatedAt,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProject(params.id, user.id);
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) throw new BadRequestError("path query required");
    const body = PutBody.parse(await req.json());
    const result = await writeFileContent(
      params.id,
      user.id,
      path,
      body.content,
      body.clientVersion,
    );
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProject(params.id, user.id);
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    const newPath = url.searchParams.get("newPath");
    if (!path) throw new BadRequestError("path query required");
    if (newPath) {
      await renameFile(params.id, user.id, path, newPath);
      return Response.json({ ok: true, renamed: true });
    }
    await deleteFile(params.id, path);
    return Response.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
