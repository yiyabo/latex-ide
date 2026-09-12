import { createHash } from "node:crypto";
import { db } from "./db";
import { getStorage, newVersionId } from "./storage";
import { assertSafePath } from "./path";
import { ConflictError, NotFoundError, BadRequestError } from "./session";
import type { FileTreeNode } from "@latex-ide/contracts";
import { getTemplateFiles, type TemplateName } from "./templates";

export async function createProjectFromTemplate(
  ownerId: string,
  name: string,
  template: TemplateName,
  entryFile = "main.tex",
) {
  const files = getTemplateFiles(template);
  const project = await db.project.create({
    data: {
      ownerId,
      name,
      entryFile,
      engine: "pdflatex",
    },
  });

  const storage = getStorage();
  for (const f of files) {
    const path = assertSafePath(f.path);
    const content = Buffer.from(f.content, "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    const versionId = newVersionId();
    const key = `projects/${project.id}/${path.split("/").map(encodeURIComponent).join("/")}#${versionId}`;
    await storage.put(key, content);
    await db.projectFile.create({
      data: {
        projectId: project.id,
        path,
        isBinary: false,
        size: content.length,
      },
    });
    await db.fileVersion.create({
      data: {
        projectId: project.id,
        path,
        contentHash: hash,
        storageKey: key,
        createdBy: ownerId,
      },
    });
  }
  return project;
}

export async function listFiles(projectId: string) {
  return db.projectFile.findMany({
    where: { projectId },
    orderBy: { path: "asc" },
  });
}

export function buildTree(files: Array<{ path: string; size: number }>): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();

  const ensureDir = (dirPath: string): FileTreeNode[] => {
    if (!dirPath) return root;
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!.children!;
    const parts = dirPath.split("/");
    const name = parts[parts.length - 1]!;
    const parentPath = parts.slice(0, -1).join("/");
    const node: FileTreeNode = {
      name,
      path: dirPath,
      type: "directory",
      children: [],
    };
    dirMap.set(dirPath, node);
    const parent = ensureDir(parentPath);
    parent.push(node);
    return node.children!;
  };

  for (const f of files) {
    const parts = f.path.split("/");
    const name = parts[parts.length - 1]!;
    const dirPath = parts.slice(0, -1).join("/");
    const siblings = ensureDir(dirPath);
    siblings.push({
      name,
      path: f.path,
      type: "file",
      size: f.size,
    });
  }

  const sortRec = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => n.children && sortRec(n.children));
  };
  sortRec(root);
  return root;
}

export async function readFileContent(projectId: string, path: string) {
  const safe = assertSafePath(path);
  const meta = await db.projectFile.findUnique({
    where: { projectId_path: { projectId, path: safe } },
  });
  if (!meta) throw new NotFoundError("File not found");

  const latest = await db.fileVersion.findFirst({
    where: { projectId, path: safe },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) throw new NotFoundError("No version for file");

  const storage = getStorage();
  const content = await storage.getText(latest.storageKey);
  return { meta, latest, content };
}

export async function writeFileContent(
  projectId: string,
  userId: string,
  path: string,
  content: string,
  clientVersion?: string,
) {
  const safe = assertSafePath(path);
  const storage = getStorage();
  const buf = Buffer.from(content, "utf8");
  const hash = createHash("sha256").update(buf).digest("hex");

  const existing = await db.projectFile.findUnique({
    where: { projectId_path: { projectId, path: safe } },
  });

  const latest = await db.fileVersion.findFirst({
    where: { projectId, path: safe },
    orderBy: { createdAt: "desc" },
  });

  if (clientVersion && latest && latest.id !== clientVersion) {
    throw new ConflictError("File has been modified by another client");
  }

  // Idempotent write when content unchanged
  if (latest && latest.contentHash === hash) {
    return { versionId: latest.id, hash, unchanged: true };
  }

  const versionId = newVersionId();
  const key = `projects/${projectId}/${safe.split("/").map(encodeURIComponent).join("/")}#${versionId}`;
  await storage.put(key, buf);

  await db.$transaction(async (tx) => {
    if (!existing) {
      await tx.projectFile.create({
        data: {
          projectId,
          path: safe,
          isBinary: false,
          size: buf.length,
        },
      });
    } else {
      await tx.projectFile.update({
        where: { projectId_path: { projectId, path: safe } },
        data: { size: buf.length, isBinary: false },
      });
    }
    await tx.fileVersion.create({
      data: {
        projectId,
        path: safe,
        contentHash: hash,
        storageKey: key,
        createdBy: userId,
      },
    });
    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  });

  return { versionId, hash, unchanged: false };
}

export async function deleteFile(projectId: string, path: string) {
  const safe = assertSafePath(path);
  const meta = await db.projectFile.findUnique({
    where: { projectId_path: { projectId, path: safe } },
  });
  if (!meta) throw new NotFoundError("File not found");
  await db.projectFile.delete({
    where: { projectId_path: { projectId, path: safe } },
  });
}

export async function renameFile(
  projectId: string,
  userId: string,
  path: string,
  newPath: string,
) {
  const safe = assertSafePath(path);
  const dest = assertSafePath(newPath);
  if (safe === dest) return;
  const meta = await db.projectFile.findUnique({
    where: { projectId_path: { projectId, path: safe } },
  });
  if (!meta) throw new NotFoundError("File not found");
  const destExists = await db.projectFile.findUnique({
    where: { projectId_path: { projectId, path: dest } },
  });
  if (destExists) throw new ConflictError("Destination already exists");

  // Copy content to new path as a new version
  const { content } = await readFileContent(projectId, safe);
  await writeFileContent(projectId, userId, dest, content);
  await deleteFile(projectId, safe);
}

export async function latestVersionId(projectId: string, path: string): Promise<string | null> {
  const latest = await db.fileVersion.findFirst({
    where: { projectId, path: assertSafePath(path) },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

export async function getProjectFilesSnapshot(projectId: string) {
  const files = await listFiles(projectId);
  const storage = getStorage();
  const out: Array<{ path: string; content: string }> = [];
  for (const f of files) {
    if (f.isBinary) continue;
    const latest = await db.fileVersion.findFirst({
      where: { projectId, path: f.path },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) continue;
    out.push({
      path: f.path,
      content: await storage.getText(latest.storageKey),
    });
  }
  return out;
}

/**
 * Full snapshot for compilation: text files as strings AND binary assets
 * (figures) as Buffers, so \includegraphics works in imported projects.
 */
export async function getProjectCompileSnapshot(
  projectId: string,
): Promise<Array<{ path: string; content: string | Buffer }>> {
  const files = await listFiles(projectId);
  const storage = getStorage();
  const out: Array<{ path: string; content: string | Buffer }> = [];
  for (const f of files) {
    const latest = await db.fileVersion.findFirst({
      where: { projectId, path: f.path },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) continue;
    const buf = await storage.get(latest.storageKey);
    out.push({
      path: f.path,
      content: f.isBinary ? buf : buf.toString("utf8"),
    });
  }
  return out;
}
