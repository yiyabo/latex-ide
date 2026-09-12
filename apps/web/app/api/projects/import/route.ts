import { requireUser, handleApiError, BadRequestError } from "@/server/session";
import { importProjectFromZip } from "@/server/import";

export const runtime = "nodejs";
// Next.js App Router body size limit (default 1MB) — raise for zip uploads
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    const rawName = String(form.get("name") || "").trim();
    if (!file || typeof file === "string") {
      throw new BadRequestError("file required");
    }

    // Derive project name: explicit field > zip filename > fallback
    const zipName = file instanceof File && file.name ? file.name.replace(/\.zip$/i, "") : "";
    const projectName = (rawName || zipName || "Imported project").slice(0, 120);

    if (!(file instanceof File)) throw new BadRequestError("file required");
    const buf = Buffer.from(await file.arrayBuffer());
    // magic check: PK\x03\x04 (or PK\x05\x06 empty archive)
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
      throw new BadRequestError("Not a zip file");
    }

    const result = await importProjectFromZip(user.id, projectName, buf);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
