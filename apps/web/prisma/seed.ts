import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const db = new PrismaClient();
const LOCAL_ROOT =
  process.env.LOCAL_STORAGE_ROOT || path.join(process.cwd(), "data", "storage");

const PAPER = [
  {
    path: "main.tex",
    content: `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{natbib}

\\title{Toward Reliable AI-Assisted Scientific Writing}
\\author{Demo Author\\\\Affiliation}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
We present a prototype AI-assisted LaTeX writing workbench that keeps the author in control.
\\end{abstract}

\\input{sections/intro}
\\input{sections/method}

\\bibliographystyle{plainnat}
\\bibliography{refs}

\\end{document}
`,
  },
  {
    path: "sections/intro.tex",
    content: `\\section{Introduction}
\\label{sec:intro}

Scientific writing is an iterative process of drafting, revising, and verifying claims against evidence.
Select this paragraph and ask the assistant to polish it.

\\begin{enumerate}
  \\item The author selects source text as the unit of work.
  \\item The assistant proposes edits as structured patches.
  \\item Every write is gated by an explicit human review step.
\\end{enumerate}

`,
  },
  {
    path: "sections/method.tex",
    content: `\\section{Method}
\\label{sec:method}

When the author selects a range, we capture offsets and surrounding lines as context.

\\begin{equation}
  \\mathrm{apply}(p) =
  \\begin{cases}
    \\mathrm{success} & \\text{if expected matches current} \\\\
    \\mathrm{conflict} & \\text{otherwise}
  \\end{cases}
\\end{equation}

`,
  },
  {
    path: "refs.bib",
    content: `@article{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111}
}
`,
  },
];

async function putFile(projectId: string, filePath: string, content: string, userId: string) {
  const buf = Buffer.from(content, "utf8");
  const hash = createHash("sha256").update(buf).digest("hex");
  const versionId = randomUUID();
  const key = `projects/${projectId}/${filePath.split("/").map(encodeURIComponent).join("/")}#${versionId}`;
  const abs = path.resolve(LOCAL_ROOT, key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  await db.projectFile.create({
    data: { projectId, path: filePath, isBinary: false, size: buf.length },
  });
  await db.fileVersion.create({
    data: { projectId, path: filePath, contentHash: hash, storageKey: key, createdBy: userId },
  });
}

async function main() {
  const email = "demo@example.com";
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        name: "Demo User",
        passwordHash: await bcrypt.hash("demo1234", 10),
      },
    });
    console.log("Created demo user demo@example.com / demo1234");
  }

  const existing = await db.project.findFirst({
    where: { ownerId: user.id, name: "Demo Paper" },
  });
  if (existing) {
    console.log("Demo project already exists:", existing.id);
    return;
  }

  const project = await db.project.create({
    data: { ownerId: user.id, name: "Demo Paper", entryFile: "main.tex", engine: "pdflatex" },
  });
  for (const f of PAPER) {
    await putFile(project.id, f.path, f.content, user.id);
  }
  console.log("Seeded project:", project.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
