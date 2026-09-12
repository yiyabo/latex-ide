import { requireUser, handleApiError } from "@/server/session";
import { getCompileResult, getPdfBuffer } from "@/server/compile";

export async function GET(req: Request, { params }: { params: { jobId: string } }) {
  try {
    await requireUser();
    const url = new URL(req.url);
    if (url.searchParams.get("download") === "1") {
      const buf = await getPdfBuffer(params.jobId);
      if (!buf) return Response.json({ error: "PDF not ready" }, { status: 404 });
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${params.jobId}.pdf"`,
        },
      });
    }
    const result = await getCompileResult(params.jobId);
    if (!result) return Response.json({ error: "Job not found" }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
