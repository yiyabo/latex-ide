import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { db } from "./db";
import { isDesktopMode, DESKTOP_USER_EMAIL, DESKTOP_USER_NAME } from "./desktop";

export async function requireUser() {
  // Desktop shell: single local user, no interactive login
  if (isDesktopMode()) {
    return getOrCreateDesktopUser();
  }

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new AuthError("Unauthorized");
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError("Unauthorized");
  return user;
}

async function getOrCreateDesktopUser() {
  const existing = await db.user.findUnique({
    where: { email: DESKTOP_USER_EMAIL },
  });
  if (existing) return existing;
  return db.user.create({
    data: {
      email: DESKTOP_USER_EMAIL,
      name: DESKTOP_USER_NAME,
    },
  });
}

export async function requireProject(projectId: string, userId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");
  if (project.ownerId !== userId) throw new ForbiddenError("Forbidden");
  return project;
}

export class AuthError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}
export class NotFoundError extends Error {
  status = 404;
}
export class ConflictError extends Error {
  status = 409;
}
export class BadRequestError extends Error {
  status = 400;
}

export function handleApiError(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return Response.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof NotFoundError) {
    return Response.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ConflictError) {
    return Response.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof BadRequestError) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  // Zod validation → 400, not 500
  if (err instanceof Error && err.name === "ZodError") {
    const zerr = err as unknown as { issues?: Array<{ path?: unknown[]; message?: string }> };
    const first = zerr.issues?.[0];
    const detail = first
      ? `${(first.path || []).join(".") || "body"}: ${first.message || "invalid"}`
      : "Invalid request body";
    return Response.json({ error: detail }, { status: 400 });
  }
  if (err instanceof Error && (err as { status?: number }).status) {
    return Response.json(
      { error: err.message },
      { status: (err as { status?: number }).status },
    );
  }
  console.error(err);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
