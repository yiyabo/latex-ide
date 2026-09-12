"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { FileText, Loader2, LogOut, Plus, Trash2, Upload, FolderUp } from "lucide-react";
import Link from "next/link";
import { Toast } from "@/components/ui/Toast";

type Project = {
  id: string;
  name: string;
  entryFile: string;
  updatedAt: string;
};

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>("paper");
  const [desktop, setDesktop] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/app-info")
      .then((r) => r.json())
      .then((d) => setDesktop(Boolean(d?.desktop)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Desktop shell skips login
    fetch("/api/app-info")
      .then((r) => r.json())
      .then((d) => {
        if (d?.desktop) return;
        if (status === "unauthenticated") router.replace("/login");
      })
      .catch(() => {
        if (status === "unauthenticated") router.replace("/login");
      });
  }, [status, router]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated" || desktop) void load();
  }, [status, desktop]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), template }),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        router.push(`/project/${data.project.id}`);
      } else {
        alert(data.error || "Failed to create project");
      }
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    void load();
  };

  const importZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (name.trim()) form.append("name", name.trim());
      const res = await fetch("/api/projects/import", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && data.projectId) {
        router.push(`/project/${data.projectId}`);
      } else {
        alert(data.error || "Import failed");
      }
    } finally {
      setImporting(false);
    }
  };

  const importFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setImporting(true);
    try {
      const form = new FormData();
      for (const f of files) {
        // Send the relative path explicitly — webkitRelativePath can be lost
        // if the server reads filename only (WKWebView quirk).
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        form.append("files", f, rel);
        form.append("paths", rel);
      }
      if (name.trim()) form.append("name", name.trim());
      const res = await fetch("/api/projects/import-folder", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && data.projectId) {
        router.push(`/project/${data.projectId}`);
      } else {
        alert(data.error || "Import failed");
      }
    } finally {
      setImporting(false);
    }
  };

  if (!desktop && (status === "loading" || status === "unauthenticated")) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="text-accent">yiyabo</span>
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>{session?.user?.email || (desktop ? "Local User" : "")}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-1 hover:text-ink"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <section className="mb-10">
          <h2 className="mb-4 text-base font-medium">New project</h2>
          <form onSubmit={create} className="flex flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
            >
              <option value="paper">Paper skeleton</option>
              <option value="ieee">IEEE conference</option>
              <option value="elsevier">Elsevier journal</option>
              <option value="blank">Blank article</option>
            </select>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={importZip}
            />
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              // @ts-expect-error non-standard but widely supported
              webkitdirectory=""
              directory=""
              multiple
              onChange={importFolder}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
              title="Import a .zip of an existing LaTeX project (Overleaf export works)"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Import zip
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
              title="Import a LaTeX project folder (.tex/.bib/figures)"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <FolderUp size={14} />}
              Import folder
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-4 text-base font-medium">Projects</h2>
          {loading ? (
            <Loader2 className="animate-spin text-muted" />
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted">No projects yet. Create one above.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3">
                  <Link
                    href={`/project/${p.id}`}
                    className="flex items-center gap-3 hover:text-accent"
                  >
                    <FileText size={16} className="text-muted" />
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-2xs text-muted">
                        {p.entryFile} · updated {new Date(p.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={() => remove(p.id)}
                    className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <Toast />
    </div>
  );
}
