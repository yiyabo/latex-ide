import { z } from "zod";

// ---- Selection context: editor → AI panel / agent ----
export const EditorSelectionContextSchema = z.object({
  projectId: z.string(),
  filePath: z.string(),
  selectionStart: z.number().int().nonnegative(),
  selectionEnd: z.number().int().nonnegative(),
  selectedText: z.string(),
  surroundingText: z.string(),
  sectionPath: z.array(z.string()),
  cursorLine: z.number().int().nonnegative(),
  language: z.enum(["tex", "bib"]),
});
export type EditorSelectionContext = z.infer<typeof EditorSelectionContextSchema>;

// ---- Compile ----
export const LatexEngineSchema = z.enum(["pdflatex", "xelatex", "lualatex"]);
export type LatexEngine = z.infer<typeof LatexEngineSchema>;

export const CompileRequestSchema = z.object({
  projectId: z.string(),
  entryFile: z.string(),
  engine: LatexEngineSchema.optional(),
});
export type CompileRequest = z.infer<typeof CompileRequestSchema>;

export const LatexDiagnosticSchema = z.object({
  filePath: z.string().optional(),
  line: z.number().int().positive().optional(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  raw: z.string().optional(),
});
export type LatexDiagnostic = z.infer<typeof LatexDiagnosticSchema>;

export const CompileStatusSchema = z.enum([
  "queued",
  "running",
  "success",
  "failed",
  "timeout",
  "cancelled",
]);
export type CompileStatus = z.infer<typeof CompileStatusSchema>;

export const CompileResultSchema = z.object({
  jobId: z.string(),
  status: CompileStatusSchema,
  pdfUrl: z.string().optional(),
  diagnostics: z.array(LatexDiagnosticSchema),
  durationMs: z.number().nonnegative(),
});
export type CompileResult = z.infer<typeof CompileResultSchema>;

// ---- AI Patch ----
export const PatchOperationSchema = z.object({
  type: z.literal("replace"),
  filePath: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  expectedOldText: z.string(),
  newText: z.string(),
});
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const PatchStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "conflict",
  "applied",
]);
export type PatchStatus = z.infer<typeof PatchStatusSchema>;

export const PatchProposalSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  summary: z.string(),
  operations: z.array(PatchOperationSchema),
  baseVersionId: z.string(),
  status: PatchStatusSchema,
});
export type PatchProposal = z.infer<typeof PatchProposalSchema>;

// ---- Conversation ----
export const MessageRoleSchema = z.enum(["user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ConversationMessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  patchProposalId: z.string().optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// ---- File tree ----
export const FileTreeNodeSchema: z.ZodType<FileTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "directory"]),
    size: z.number().optional(),
    children: z.array(FileTreeNodeSchema).optional(),
  })
);
export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileTreeNode[];
};

export const ProjectFileMetaSchema = z.object({
  projectId: z.string(),
  path: z.string(),
  isBinary: z.boolean(),
  size: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type ProjectFileMeta = z.infer<typeof ProjectFileMetaSchema>;

export const FileVersionMetaSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  path: z.string(),
  contentHash: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type FileVersionMeta = z.infer<typeof FileVersionMetaSchema>;

// ---- Project ----
export const ProjectMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  entryFile: z.string(),
  engine: LatexEngineSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

export const ProjectTemplateSchema = z.enum(["blank", "paper"]);
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>;

// ---- API bodies ----
export const CreateProjectBodySchema = z.object({
  name: z.string().min(1).max(120),
  template: ProjectTemplateSchema.default("paper"),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const PutFileBodySchema = z.object({
  content: z.string(),
  clientVersion: z.string().optional(),
});
export type PutFileBody = z.infer<typeof PutFileBodySchema>;

export const RenameFileBodySchema = z.object({
  newPath: z.string().min(1).max(255),
});
export type RenameFileBody = z.infer<typeof RenameFileBodySchema>;

export const AcceptPatchBodySchema = z.object({
  baseVersionId: z.string().optional(),
});
export type AcceptPatchBody = z.infer<typeof AcceptPatchBodySchema>;

export const ChatBodySchema = z.object({
  conversationId: z.string().nullish(),
  projectId: z.string(),
  message: z.string().min(1),
  selection: EditorSelectionContextSchema.nullish(),
  action: z.string().nullish(),
});
export type ChatBody = z.infer<typeof ChatBodySchema>;

// ---- SSE events for AI chat ----
export const ChatSseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), content: z.string() }),
  z.object({ type: z.literal("tool_call"), name: z.string(), args: z.unknown() }),
  z.object({ type: z.literal("patch_proposal"), proposal: PatchProposalSchema }),
  z.object({ type: z.literal("done"), conversationId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;

// ---- AI quick actions ----
export const QuickActionSchema = z.enum([
  "polish",
  "expand",
  "condense",
  "fix_latex",
  "translate_academic",
]);
export type QuickAction = z.infer<typeof QuickActionSchema>;

export const QUICK_ACTION_LABELS: Record<QuickAction, string> = {
  polish: "润色",
  expand: "扩写",
  condense: "压缩",
  fix_latex: "修复 LaTeX",
  translate_academic: "译为学术英文",
};

// ---- Storage key helper ----
export function storageKey(projectId: string, path: string, versionId?: string): string {
  const safe = path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return versionId
    ? `projects/${projectId}/${safe}#${versionId}`
    : `projects/${projectId}/${safe}`;
}

// ---- Path safety ----
export function isSafeProjectPath(path: string): boolean {
  if (!path || path.length > 255) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.includes("..")) return false;
  if (path.includes("\0")) return false;
  const parts = path.split("/");
  return parts.every((p) => p.length > 0 && p !== "." && p !== "..");
}
