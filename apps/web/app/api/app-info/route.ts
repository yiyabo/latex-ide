import { isDesktopMode } from "@/server/desktop";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    desktop: isDesktopMode(),
    name: "yiyabo",
  });
}
