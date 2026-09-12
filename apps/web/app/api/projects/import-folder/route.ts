import { requireUser, handleApiError, BadRequestError } from "@/server/session";
import { importProjectFromFiles } from "@/server/import";
import type { ImportInputFile } from "@/server/import";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Folder import: a multi-file POST (webkitdirectory drop or manual pick).
 * Files carry their relative paths in filename ("sub/dir/file.tex").
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const rawName = String(form.get("name") || "").trim();
    const projectName = rawName.slice(0, 120) || "Imported folder";

    const files: ImportInputFile[] = [];
    const paths = form.getAll("paths").map(String);
    const entries = form.getAll("files");
    let i = 0;
    for (const entry of entries) {
      if (entry instanceof File) {
        // Prefer the explicit "paths" field (index-aligned) — WKWebView sometimes
        // drops webkitRelativePath and server-side filename may be flattened.
        const explicit = paths[i];
        const rel =
          (explicit && explicit !== entry.name
            ? explicit
            : (entry as File & { webkitRelativePath?: string }).webkitRelativePath) ||
          entry.name;
        files.push({ path: rel, data: Buffer.from(await entry.arrayBuffer()) });
      }
      i++;
    }
    if (files.length === 0) throw new BadRequestError("no files in request");

    const result = await importProjectFromFiles(user.id, projectName, files);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
