import { db } from "../db";
import { getStorage, newVersionId } from "../storage";
import { getCompileResult, enqueueCompile } from "../compile";
import { SYSTEM_PROMPT } from "./index";
import { getProviderForUser } from "./config";
import {
  latestVersionId,
  readFileContent,
  listFiles,
  buildTree,
  getProjectCompileSnapshot,
} from "../files";
import { ConflictError, NotFoundError } from "../session";
import {
  buildProjectIndex,
  summarizeIndex,
  buildFixPlan,
} from "@latex-ide/latex";
import {
  searchAllSources,
  searchPubMed,
  searchEuropePmc,
  searchOpenAlex,
  searchCrossref,
  getPubMedAbstract,
  searchWeb,
} from "../research";
import type { PaperHit } from "../research";
import type { EditorSelectionContext, PatchOperation, PatchProposal } from "@latex-ide/contracts";
import { createHash } from "node:crypto";

function toolLabel(name: string): string {
  const map: Record<string, string> = {
    read_file_range: "读取文件片段",
    get_compile_errors: "读取编译错误",
    read_selection: "读取选区",
    propose_patch: "生成修改建议",
    search_project: "检索项目",
    list_project_files: "列出项目文件",
    get_project_structure: "查看项目结构",
    get_project_index: "分析项目索引",
    check_figure_paths: "检查图表引用",
    request_compile: "触发编译",
    search_literature: "文献检索",
    get_pubmed_abstract: "获取文献摘要",
    web_search: "联网搜索",
  };
  return map[name] || name;
}

const QUICK_PROMPTS: Record<string, string> = {
  polish: "Polish the selected text for academic clarity and flow. Preserve meaning and technical content.",
  expand: "Expand the selected text with more detail, examples, or justification while staying concise.",
  condense: "Condense the selected text without losing essential claims.",
  fix_latex: "Fix any LaTeX syntax issues in the selection (unbalanced braces, bad environments, unescaped characters).",
  translate_academic: "Rewrite the selected text in polished academic English if it is not already, or improve register if it is.",
};

const LAYOUT_WARNING_REQUEST = /(?:修复|解决|处理|消除|fix|resolve|remove|address|layout|排版).*(?:warning|警告|hbox|vbox|overfull|underfull)|(?:warning|警告|hbox|vbox|overfull|underfull).*(?:修复|解决|处理|消除|fix|resolve|remove|address|layout|排版)/i;

function requestsLayoutWarningFix(message: string, action?: string): boolean {
  return action === "fix_latex" || LAYOUT_WARNING_REQUEST.test(message);
}

export async function runChat(params: {
  projectId: string;
  userId: string;
  message: string;
  selection: EditorSelectionContext | null;
  action?: string;
  conversationId?: string;
  onEvent: (event: {
    type: "token" | "tool_call" | "patch_proposal" | "done" | "error" | "status" | "conversation";
    [k: string]: unknown;
  }) => void;
}) {
  const { projectId, userId, message, selection, action, onEvent } = params;

  // Resolve or create conversation
  let conversationId = params.conversationId;
  if (conversationId) {
    const conv = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.projectId !== projectId) throw new NotFoundError("Conversation not found");
  } else {
    const conv = await db.conversation.create({
      data: {
        projectId,
        title: (action ? QUICK_PROMPTS[action]?.slice(0, 40) : message.slice(0, 40)) || "Chat",
      },
    });
    conversationId = conv.id;
  }

  const userText = buildUserText(message, selection, action);
  await db.message.create({
    data: { conversationId, role: "user", content: userText },
  });

  // History (last 12 messages)
  const history = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 12,
  });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant" | "tool",
      content: m.content,
    })),
  ];

  const { provider } = await getProviderForUser(userId);
  let assistantText = "";

  try {
    const working = [...messages];
    let patchProposal: PatchProposal | null = null;

    // ---- Agent run budget: prevents runaway loops from burning tokens/time.
    const BUDGET = {
      maxRounds: 10, // LLM round-trips
      maxToolCalls: 16, // total tool executions
      maxWallMs: 180_000, // 3 minutes hard wall
      startedAt: Date.now(),
    };
    let toolCallsUsed = 0;
    let patchFailed = false; // persists across rounds until a patch succeeds
    const budgetExceeded = (): string | null => {
      const elapsed = Date.now() - BUDGET.startedAt;
      if (elapsed > BUDGET.maxWallMs)
        return `已达到时间上限（${Math.round(elapsed / 1000)}s / ${BUDGET.maxWallMs / 1000}s）`;
      if (toolCallsUsed >= BUDGET.maxToolCalls)
        return `已达到工具调用上限（${BUDGET.maxToolCalls} 次）`;
      return null;
    };

    for (let round = 0; round <= BUDGET.maxRounds; round++) {
      const overrun = round > 0 ? budgetExceeded() : null;
      if (overrun) {
        onEvent({ type: "status", message: overrun });
        assistantText += `\n\n---\n⚠️ ${overrun}。以上是当前已完成的分析与结论；如需继续，请回复"继续"。`;
        break;
      }
      let roundText = "";
      onEvent({
        type: "status",
        message: round === 0 ? "正在调用模型…" : "根据工具结果继续推理…",
      });
      const res = await provider.chat({
        messages: working,
        onStream: (t) => {
          roundText += t;
          assistantText += t;
          onEvent({ type: "token", content: t });
        },
      });
      if (!roundText && res.content) {
        roundText = res.content;
        assistantText += res.content;
        if (res.content) onEvent({ type: "token", content: res.content });
      }

      const toolCalls = res.toolCalls || [];
      const usedToolNames = new Set(toolCalls.map((tc) => tc.name));
      if (toolCalls.length === 0) {
        // A failed propose_patch means the model owes the user either a retry
        // or an explicit explanation. An empty response here is a model hiccup
        // (e.g. GLM returning nothing after a tool-heavy round) — nudge once.
        if (patchFailed && !roundText && round < BUDGET.maxRounds) {
          working.push({
            role: "user",
            content: "SYSTEM: your last response was empty. Retry the propose_patch call now (with filePath + operations) or explain to the user why you cannot complete the edit.",
          });
          continue;
        }
        break;
      }

      // Classify tools
      let madePatch = false;
      const sideEffectTools: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      for (const tc of toolCalls) {
        onEvent({ type: "tool_call", name: tc.name, args: tc.args });
        if (tc.name === "propose_patch") {
          if (selection) {
            patchProposal = await createPatchFromToolArgs({
              projectId,
              conversationId,
              selection,
              args: tc.args,
            });
            onEvent({ type: "patch_proposal", proposal: patchProposal });
            madePatch = true;
          } else if (usedToolNames.has("propose_patch")) {
            // No selection: the patch targets must come from args.filePath.
            // Previously this case was silently dropped — the model believed
            // it had submitted an edit while nothing happened (user-visible
            // as "生成修改建议 ✓" with no diff).
            try {
              patchProposal = await createPatchFromToolArgs({
                projectId,
                conversationId,
                selection: await selectionFromFileArgs(tc.args, projectId),
                args: tc.args,
              });
              onEvent({ type: "patch_proposal", proposal: patchProposal });
              madePatch = true;
              patchFailed = false;
            } catch (err) {
              const reason =
                err instanceof Error ? err.message : String(err);
              patchFailed = true;
              working.push({
                role: "user",
                content: `SYSTEM: propose_patch FAILED — ${reason}. Fix: either ask the user to select text in the editor, or re-call propose_patch with explicit "filePath" and operations whose expectedOldText matches that file's exact content. Do not claim the edit was submitted until a patch_proposal event succeeds.`,
              });
            }
          }
        } else {
          sideEffectTools.push(tc);
        }
      }

      // Fallback: operations without explicit propose_patch
      if (!patchProposal && !madePatch && selection) {
        const ops = findOperations(toolCalls);
        if (ops.length > 0) {
          patchProposal = await createPatchFromToolArgs({
            projectId,
            conversationId,
            selection,
            args: { summary: "Proposed edit", operations: ops },
          });
          onEvent({ type: "patch_proposal", proposal: patchProposal });
          madePatch = true;
        }
      }

      // Don't break when a propose_patch just failed: the model needs another
      // round to see the SYSTEM feedback and retry/correct.
      if (madePatch || (sideEffectTools.length === 0 && !patchFailed)) break;

      // Execute read-only tools and continue the loop
      working.push({
        role: "assistant",
        content: roundText || "Calling tools",
      });
      for (const tc of sideEffectTools) {
        if (toolCallsUsed >= BUDGET.maxToolCalls) {
          working.push({
            role: "user",
            content: `SYSTEM: tool budget exhausted (${BUDGET.maxToolCalls} calls). Summarize your findings and stop calling tools.`,
          });
          continue;
        }
        toolCallsUsed++;
        onEvent({ type: "status", message: `执行 ${toolLabel(tc.name)}…` });
        const result = await executeReadOnlyTool(projectId, tc.name, tc.args, {
          userRequest: message,
          action,
        });
        onEvent({ type: "tool_call", name: `${tc.name}:result`, args: { preview: result.slice(0, 200) } });
        working.push({
          role: "user",
          content: `TOOL RESULT (${tc.name}):
${result}

Continue. If you are ready to edit text, call propose_patch with expectedOldText and newText.`,
        });
      }
    }

    // Force a final summary if the loop ended (budget/rounds exhausted) with
    // tool activity but no user-visible text — otherwise the panel shows only
    // "Calling tools" and the user can't tell what happened.
    if (!assistantText.trim() || assistantText.trim() === "Calling tools") {
      try {
        onEvent({ type: "status", message: "生成最终总结…" });
        working.push({
          role: "user",
          content:
            "SYSTEM: tool budget reached. Based on all tool results above, write your final answer to the user now — summarize findings, list any proposed fixes, and stop calling tools.",
        });
        const res = await provider.chat({
          messages: working,
          onStream: (t) => {
            assistantText += t;
            onEvent({ type: "token", content: t });
          },
        });
        if (!assistantText && res.content) assistantText = res.content;
      } catch {
        /* keep whatever text we have */
      }
    }

    if (!assistantText) assistantText = "Ready.";

    const assistantMsg = await db.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: assistantText,
      },
    });

    if (patchProposal) {
      await db.patchProposal.update({
        where: { id: patchProposal.id },
        data: { messageId: assistantMsg.id },
      });
    }

    onEvent({
      type: "conversation",
      conversation: {
        id: conversationId,
        projectId,
        title: (action ? QUICK_PROMPTS[action]?.slice(0, 40) : message.slice(0, 40)) || "Chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    onEvent({
      type: "done",
      conversationId,
      messageId: assistantMsg.id,
    });
  } catch (err) {
    onEvent({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function executeReadOnlyTool(
  projectId: string,
  name: string,
  args: Record<string, unknown>,
  context: { userRequest: string; action?: string } = { userRequest: "" },
): Promise<string> {
  try {
    if (name === "read_file_range") {
      const path = String(args.path || "");
      const startLine = Number(args.startLine || 1);
      const endLine = Number(args.endLine || startLine + 50);
      const { content } = await readFileContent(projectId, path);
      const lines = content.split("\n");
      const slice = lines.slice(Math.max(0, startLine - 1), endLine);
      return slice
        .map((l, i) => `${startLine + i}: ${l}`)
        .join("\n")
        .slice(0, 8000);
    }
    if (name === "get_compile_errors") {
      const jobId = args.jobId as string | undefined;
      // Prefer explicit job, else latest for project
      let result = jobId ? await getCompileResult(jobId) : null;
      if (!result) {
        const last = await db.compileJob.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });
        if (!last) return "No compile has been run yet.";
        result = await getCompileResult(last.id);
      }
      if (!result) return "No compile result.";
      // Attach a classified fix plan so the agent can route each error
      // instead of re-diagnosing from raw strings every round.
      const plan = buildFixPlan(result.diagnostics, {
        includeLayoutWarnings: requestsLayoutWarningFix(context.userRequest, context.action),
      });
      return JSON.stringify(
        {
          status: result.status,
          durationMs: result.durationMs,
          fixPlan: plan.plan,
          fixableErrors: plan.fixable.map((d) => ({
            category: d.category,
            file: d.filePath,
            line: d.line,
            message: d.message,
          })),
          environmentIssues: plan.environmentOnly.map((d) => d.message),
          warnings: plan.noise.filter((d) => d.category === "warning").map((d) => d.message),
        },
        null,
        2,
      ).slice(0, 8000);
    }
    if (name === "read_selection") {
      return "Selection context is already provided in the user message.";
    }
    if (name === "list_project_files") {
      const files = await listFiles(projectId);
      return files
        .map((f) => `${f.path}${f.isBinary ? " (binary)" : ""} — ${f.size}B`)
        .join("\n")
        .slice(0, 4000);
    }
    if (name === "get_project_structure") {
      const files = await listFiles(projectId);
      const tree = buildTree(files.map((f) => ({ path: f.path, size: f.size })));
      const render = (nodes: import("@latex-ide/contracts").FileTreeNode[], indent = ""): string =>
        nodes
          .map((n) => {
            const line = `${indent}${n.name}${n.type === "directory" ? "/" : ""}`;
            return n.type === "directory"
              ? `${line}\n${render(n.children ?? [], indent + "  ")}`
              : line;
          })
          .join("\n");
      return render(tree).slice(0, 4000);
    }
    if (name === "get_project_index") {
      // One-shot structural analysis: entry file, input graph, figure/label/citation
      // reconciliation, packages. Replaces 4-6 blind read_file_range rounds.
      const snapshot = await getProjectCompileSnapshot(projectId);
      const fileMap = new Map<string, string>();
      for (const f of snapshot) {
        if (!/\.(png|jpe?g|pdf|eps|gif|tiff?)$/i.test(f.path)) {
          fileMap.set(f.path, typeof f.content === "string" ? f.content : f.content.toString("utf8"));
        }
      }
      const idx = buildProjectIndex(fileMap);
      return summarizeIndex(idx).slice(0, 5000);
    }
    if (name === "check_figure_paths") {
      // Cross-check \includegraphics targets against actual files (index-backed)
      const snapshot = await getProjectCompileSnapshot(projectId);
      const fileMap = new Map<string, string>();
      for (const f of snapshot) {
        if (!/\.(png|jpe?g|pdf|eps|gif|tiff?)$/i.test(f.path)) {
          fileMap.set(f.path, typeof f.content === "string" ? f.content : f.content.toString("utf8"));
        }
      }
      const idx = buildProjectIndex(fileMap);
      const exists = new Set(snapshot.map((f) => f.path));
      const lines: string[] = [];
      for (const ref of idx.referencedFigures) {
        const candidates = [ref, `${ref}.png`, `${ref}.pdf`, `${ref}.jpg`];
        const found = candidates.some((c) => exists.has(c));
        lines.push(`${found ? "OK " : "MISSING "} ${ref}`);
      }
      if (idx.orphanedFigures.length) {
        lines.push(`ORPHANED (on disk, never referenced): ${idx.orphanedFigures.join(", ")}`);
      }
      return lines.length ? lines.join("\n") : "No \\includegraphics references found.";
    }
    if (name === "request_compile") {
      const proj = await db.project.findUnique({ where: { id: projectId } });
      if (!proj) return "Project not found.";
      const jobId = await enqueueCompile(
        projectId,
        proj.entryFile,
        proj.engine as "pdflatex" | "xelatex" | "lualatex",
      );
      // Poll up to ~45s for a terminal status
      for (let i = 0; i < 22; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await getCompileResult(jobId);
        if (res && res.status !== "queued" && res.status !== "running") {
          const errs = res.diagnostics.filter((d) => d.severity === "error");
          return JSON.stringify(
            {
              jobId,
              status: res.status,
              pdfUrl: res.pdfUrl,
              errorCount: errs.length,
              errors: errs.slice(0, 5).map((d) => ({
                file: d.filePath,
                line: d.line,
                message: d.message,
              })),
            },
            null,
            2,
          ).slice(0, 6000);
        }
      }
      return `Compile ${jobId} still running after 45s — check back with get_compile_errors.`;
    }
    if (name === "search_literature") {
      const query = String(args.query || "").trim();
      if (!query) return "query required";
      const source = String(args.source || "all").toLowerCase();
      const limit = Math.min(10, Math.max(1, Number(args.limit ?? 5)));
      const hits = await (async () => {
        switch (source) {
          case "pubmed": return searchPubMed(query, limit);
          case "europepmc": return searchEuropePmc(query, limit);
          case "openalex": return searchOpenAlex(query, limit);
          case "crossref": return searchCrossref(query, limit);
          default: {
            const all = await searchAllSources(query, Math.ceil(limit / 2));
            return all.papers;
          }
        }
      })();
      if (hits.length === 0) return `No results for "${query}" (source: ${source}).`;
      const fmt = (p: PaperHit, i: number) =>
        [
          `[${i + 1}] ${p.title}`,
          `    ${p.authors.slice(0, 4).join(", ")}${p.authors.length > 4 ? " et al." : ""}`,
          `    ${p.year ?? "n.d."} · ${p.venue ?? "unknown venue"} · cited ${p.citationCount ?? "?"}×`,
          `    DOI: ${p.doi ?? "none"}`,
          p.abstract ? `    Abstract: ${p.abstract.slice(0, 300)}…` : "",
        ]
          .filter(Boolean)
          .join("\n");
      return (
        `Found ${hits.length} papers for "${query}" (source: ${source}).\n\n` +
        hits.map(fmt).join("\n\n") +
        `\n\nBibTeX (first result):\n${hits[0]!.bibtex}` +
        `\n\nCITE HONESTLY: only cite papers that actually appear above. Never invent references.`
      ).slice(0, 9000);
    }
    if (name === "get_pubmed_abstract") {
      const pmid = String(args.pmid || "").trim();
      if (!pmid) return "pmid required";
      const abs = await getPubMedAbstract(pmid);
      if (!abs) return `No abstract found for PMID ${pmid}.`;
      return abs.abstract.slice(0, 4000);
    }
    if (name === "web_search") {
      const query = String(args.query || "").trim();
      if (!query) return "query required";
      const limit = Math.min(10, Math.max(1, Number(args.limit ?? 5)));
      const results = await searchWeb(query, limit);
      if (results === null) {
        return "Web search is not configured. The user needs to place their Tavily API key in: ~/Library/Application Support/com.yiyabo.desktop/tavily.key (or set TAVILY_API_KEY). Academic databases (search_literature) work without any key — prefer those for papers.";
      }
      if (results.length === 0) return `No web results for "${query}".`;
      return (
        `Web results for "${query}":\n\n` +
        results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`,
          )
          .join("\n\n")
      ).slice(0, 8000);
    }
    return `Unknown or unsupported tool: ${name}`;
  } catch (e) {
    return `Tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function findOperations(
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
): PatchOperation[] {
  for (const tc of toolCalls) {
    const ops = (tc.args as { operations?: unknown }).operations;
    if (Array.isArray(ops)) {
      return ops as PatchOperation[];
    }
  }
  return [];
}

function buildUserText(
  message: string,
  selection: EditorSelectionContext | null,
  action?: string,
): string {
  const parts: string[] = [];
  if (action && QUICK_PROMPTS[action]) {
    parts.push(QUICK_PROMPTS[action]!);
  }
  if (message && message !== action) {
    parts.push(message);
  }
  if (selection) {
    parts.push(
      `FILE: ${selection.filePath}\nLINES: ${selection.cursorLine}\nSECTION: ${selection.sectionPath.join(" > ") || "(root)"}\n\nSELECTED TEXT:\n${selection.selectedText}\n\nSURROUNDING:\n${selection.surroundingText}`,
    );
  }
  return parts.join("\n\n") || message;
}

/**
 * Build a selection-like context from explicit tool args (no editor selection).
 * Lets propose_patch work without a selection: the model supplies filePath and
 * operations whose expectedOldText anchors the edit in that file.
 */
async function selectionFromFileArgs(
  args: Record<string, unknown>,
  projectId: string,
): Promise<EditorSelectionContext> {
  let filePath = String(args.filePath || "").trim();
  if (!filePath) {
    // Models frequently omit filePath when no selection is active. Fall back
    // to the project entry file — the overwhelmingly common edit target for
    // "优化摘要 / 润色正文" style requests.
    const proj = await db.project.findUnique({
      where: { id: projectId },
      select: { entryFile: true },
    });
    filePath = proj?.entryFile || "";
    if (!filePath) {
      throw new Error(
        'no "filePath" in propose_patch args and project has no entryFile (no editor selection is active)',
      );
    }
  }
  const { content } = await readFileContent(projectId, filePath);
  const lines = content.split("\n");
  const first = String(
    (args.operations as Array<Record<string, unknown>>)?.[0]?.expectedOldText ?? "",
  );
  // locate the first operation's anchor for cursorLine/sectionPath metadata
  let line = 1;
  if (first) {
    const idx = content.indexOf(first);
    if (idx >= 0) line = content.slice(0, idx).split("\n").length;
  }
  return {
    projectId,
    filePath,
    selectionStart: 0,
    selectionEnd: 0,
    cursorLine: line,
    selectedText: "",
    surroundingText: lines.slice(Math.max(0, line - 3), line + 2).join("\n"),
    sectionPath: [],
    language: /\.bib$/i.test(filePath) ? "bib" : "tex",
  };
}

async function createPatchFromToolArgs(opts: {
  projectId: string;
  conversationId: string;
  selection: EditorSelectionContext;
  args: Record<string, unknown>;
}): Promise<PatchProposal> {
  const { projectId, conversationId, selection, args } = opts;
  const summary = String(args.summary || "Proposed edit");
  const rawOps = (args.operations || []) as Array<Record<string, unknown>>;

  const { content } = await readFileContent(projectId, selection.filePath);
  const baseVersionId = (await latestVersionId(projectId, selection.filePath)) || "";

  const operations: PatchOperation[] = [];
  for (const op of rawOps) {
    const expected = String(op.expectedOldText ?? selection.selectedText);
    const newText = String(op.newText ?? "");
    // Locate expected text at selection offsets if possible
    let start = selection.selectionStart;
    let end = selection.selectionEnd;
    if (content.slice(start, end) !== expected) {
      const idx = content.indexOf(expected);
      if (idx >= 0) {
        start = idx;
        end = idx + expected.length;
      }
    }
    operations.push({
      type: "replace",
      filePath: selection.filePath,
      start,
      end,
      expectedOldText: expected,
      newText,
    });
  }

  if (operations.length === 0) {
    throw new Error("propose_patch produced no operations");
  }

  const created = await db.patchProposal.create({
    data: {
      conversationId,
      summary,
      operations: operations as unknown as object,
      baseVersionId,
      status: "pending",
    },
  });

  return {
    id: created.id,
    conversationId,
    summary,
    operations,
    baseVersionId,
    status: "pending",
  };
}

export async function acceptPatch(patchId: string, userId: string) {
  const patch = await db.patchProposal.findUnique({
    where: { id: patchId },
    include: { conversation: { include: { project: true } } },
  });
  if (!patch) throw new NotFoundError("Patch not found");
  if (patch.status !== "pending") {
    throw new ConflictError(`Patch already ${patch.status}`);
  }
  const project = patch.conversation.project;
  if (project.ownerId !== userId) throw new NotFoundError("Patch not found");

  const ops = patch.operations as unknown as PatchOperation[];
  // Apply ops sequentially on current content
  let currentPath = ops[0]?.filePath;
  if (!currentPath) throw new Error("No operations");

  const { content, latest } = await readFileContent(project.id, currentPath);
  let text = content;

  // Validate all ops against current text before writing
  const sorted = [...ops].sort((a, b) => a.start - b.start);
  for (const op of sorted) {
    if (op.filePath !== currentPath) {
      throw new ConflictError("Multi-file patches not supported in v1");
    }
    const actual = text.slice(op.start, op.end);
    if (actual !== op.expectedOldText) {
      // Try to re-locate
      const idx = text.indexOf(op.expectedOldText);
      if (idx < 0) {
        await db.patchProposal.update({
          where: { id: patchId },
          data: { status: "conflict" },
        });
        throw new ConflictError("Document changed since proposal was generated");
      }
    }
  }

  // Apply from end to start so offsets stay valid
  for (const op of [...sorted].reverse()) {
    let start = op.start;
    let end = op.end;
    if (text.slice(start, end) !== op.expectedOldText) {
      const idx = text.indexOf(op.expectedOldText);
      if (idx < 0) throw new ConflictError("Conflict");
      start = idx;
      end = idx + op.expectedOldText.length;
    }
    text = text.slice(0, start) + op.newText + text.slice(end);
  }

  // Create new version
  const buf = Buffer.from(text, "utf8");
  const hash = createHash("sha256").update(buf).digest("hex");
  const versionId = newVersionId();
  const key = `projects/${project.id}/${currentPath.split("/").map(encodeURIComponent).join("/")}#${versionId}`;
  await getStorage().put(key, buf);

  await db.$transaction(async (tx) => {
    await tx.projectFile.update({
      where: { projectId_path: { projectId: project.id, path: currentPath! } },
      data: { size: buf.length },
    });
    await tx.fileVersion.create({
      data: {
        projectId: project.id,
        path: currentPath!,
        contentHash: hash,
        storageKey: key,
        createdBy: userId,
      },
    });
    await tx.patchProposal.update({
      where: { id: patchId },
      data: { status: "applied" },
    });
    await tx.project.update({
      where: { id: project.id },
      data: { updatedAt: new Date() },
    });
  });

  return { versionId, content: text, latestVersionId: latest.id };
}

export async function rejectPatch(patchId: string, userId: string) {
  const patch = await db.patchProposal.findUnique({
    where: { id: patchId },
    include: { conversation: { include: { project: true } } },
  });
  if (!patch) throw new NotFoundError("Patch not found");
  if (patch.conversation.project.ownerId !== userId) {
    throw new NotFoundError("Patch not found");
  }
  await db.patchProposal.update({
    where: { id: patchId },
    data: { status: "rejected" },
  });
  return { status: "rejected" as const };
}

export async function listConversations(projectId: string) {
  const rows = await db.conversation.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      patches: { orderBy: { createdAt: "asc" } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    messages: c.messages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant" | "tool",
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    patches: c.patches.map((p) => ({
      id: p.id,
      conversationId: p.conversationId,
      summary: p.summary,
      operations: p.operations,
      baseVersionId: p.baseVersionId,
      status: p.status as PatchProposal["status"],
      messageId: p.messageId,
      createdAt: p.createdAt.toISOString(),
    })),
  }));
}

void getCompileResult;
