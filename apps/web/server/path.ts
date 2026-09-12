import { isSafeProjectPath } from "@latex-ide/contracts";

export function assertSafePath(p: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!isSafeProjectPath(normalized)) {
    throw new PathError(`Invalid path: ${p}`);
  }
  return normalized;
}

export class PathError extends Error {
  status = 400;
}

export function fileId(projectId: string, path: string): string {
  return `${projectId}::${path}`;
}
