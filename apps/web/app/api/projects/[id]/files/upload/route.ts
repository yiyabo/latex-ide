import { requireUser, requireProject, handleApiError, BadRequestError } from "@/server/session";
import { getStorage, newVersionId } from "@/server/storage";
import { assertSafePath } from "@/server/path";
import { db } from "@/server/db";
import { createHash } from "node:crypto";

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".pdf", ".svg", ".eps"]);
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProject(params.id, user.id);

    const form = await req.formData();
    const file = form.get("file");
    const path = String(form.get("path") || "");
    if (!file || typeof file === "string") throw new BadRequestError("file required");
    if (!path) throw new BadRequestError("path required");

    const safe = assertSafePath(path);
    const ext = safe.toLowerCase().slice(safe.lastIndexOf("."));
    if (!ALLOWED_EXT.has(ext)) throw new BadRequestError("File type not allowed");
    if (file.size > MAX_SIZE) throw new BadRequestError("File too large (max 10MB)");

    const buf = Buffer.from(await file.arrayBuffer());
    // light magic-byte check for png/jpeg/pdf
    if (ext === ".png" && !(buf[0] === 0x89 && buf[1] === 0x50)) {
      throw new BadRequestError("Invalid PNG");
    }
    if (ext === ".jpg" || ext === ".jpeg") {
      if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw new BadRequestError("Invalid JPEG");
    }
    if (ext === ".pdf" && buf.subarray(0, 4).toString() !== "%PDF") {
      throw new BadRequestError("Invalid PDF");
    }

    const hash = createHash("sha256").update(buf).digest("hex");
    const versionId = newVersionId();
    const key = `projects/${params.id}/${safe.split("/").map(encodeURIComponent).join("/")}#${versionId}`;
    await getStorage().put(key, buf);

    await db.$transaction(async (tx) => {
      const existing = await tx.projectFile.findUnique({
        where: { projectId_path: { projectId: params.id, path: safe } },
      });
      if (existing) {
        await tx.projectFile.update({
          where: { projectId_path: { projectId: params.id, path: safe } },
          data: { size: buf.length, isBinary: true },
        });
      } else {
        await tx.projectFile.create({
          data: { projectId: params.id, path: safe, isBinary: true, size: buf.length },
        });
      }
      await tx.fileVersion.create({
        data: {
          projectId: params.id,
          path: safe,
          contentHash: hash,
          storageKey: key,
          createdBy: user.id,
        },
      });
    });

    return Response.json({ path: safe, size: buf.length, versionId }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
