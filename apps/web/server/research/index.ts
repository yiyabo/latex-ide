/**
 * Free academic search sources — no API keys required.
 *
 * Sources (all verified reachable from the target deployment region):
 *  - PubMed (NCBI E-utilities): biomedical literature. 3 req/s without key.
 *  - Europe PMC: biomedical + life sciences, includes abstracts & citation counts.
 *  - OpenAlex: broad scholarly index (250M+ works), great metadata.
 *  - Crossref: DOI metadata + citation counts for journal publishers.
 *
 * Note: arXiv's export API is blocked from some regions (connection reset),
 * so it is intentionally not a source here; OpenAlex covers arXiv preprints
 * with `filter:primary_location.source.is_in_doaj` or type:preprint searches.
 *
 * Tavily (general web search) is also available when the user configures their
 * own API key — see loadTavilyKey() below. Keys are read from the environment
 * or the app data dir at runtime and are NEVER embedded in the bundle.
 */
import fsSync from "node:fs";
import pathMod from "node:path";

const UA = "yiyabo-research-agent/0.1 (academic writing workbench)";
type FetchOpts = { timeoutMs?: number };

async function fetchJson(url: string, opts: FetchOpts = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export type PaperHit = {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  citationCount?: number;
  source: "pubmed" | "europepmc" | "openalex" | "crossref";
  /** Ready-to-paste BibTeX entry */
  bibtex: string;
};

function cleanAbstract(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // PubMed/EuropePMC embed <jats:*> tags — strip them
  const txt = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return txt.length > 0 ? txt.slice(0, 1500) : undefined;
}

function makeBibtexKey(authors: string[], year: number | undefined, title: string): string {
  const first = (authors[0] || "unknown").split(/[\s,]+/).filter(Boolean).pop() || "unknown";
  const clean = first.replace(/[^a-zA-Z]/g, "");
  const word =
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .find((w) => w.length > 3) || "paper";
  return `${clean}${year ?? ""}${word}`;
}

function toBibtex(h: Omit<PaperHit, "bibtex" | "source"> & { sourceType: string }): string {
  const key = makeBibtexKey(h.authors, h.year, h.title);
  const authors = h.authors.length
    ? h.authors.slice(0, 12).join(" and ") + (h.authors.length > 12 ? " and others" : "")
    : "Unknown";
  const lines = [
    `@article{${key},`,
    `  title   = {${h.title}},`,
    `  author  = {${authors}},`,
  ];
  if (h.year) lines.push(`  year    = {${h.year}},`);
  if (h.venue) lines.push(`  journal = {${h.venue}},`);
  if (h.doi) lines.push(`  doi     = {${h.doi}},`);
  if (h.url) lines.push(`  url     = {${h.url}},`);
  lines.push(`  note    = {Retrieved via ${h.sourceType}}`, `}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// PubMed (NCBI E-utilities)
// ---------------------------------------------------------------------------
export async function searchPubMed(
  query: string,
  limit = 8,
): Promise<PaperHit[]> {
  // Step 1: esearch → PMIDs
  const esearch = (await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(
      query,
    )}&retmax=${limit}&retmode=json&sort=relevance`,
  )) as { esearchresult?: { idlist?: string[] } };
  const ids = esearch.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  // Step 2: esummary → metadata
  const esum = (await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(
      ",",
    )}&retmode=json`,
  )) as {
    result?: Record<
      string,
      {
        title?: string;
        fulljournalname?: string;
        pubdate?: string;
        elocationid?: string;
        doi?: string;
        authors?: Array<{ name?: string }>;
      }
    >;
  };
  const result = esum.result ?? {};
  const hits: PaperHit[] = [];
  for (const pmid of ids) {
    const r = result[pmid];
    if (!r?.title) continue;
    const authors = (r.authors ?? []).map((a) => a.name || "").filter(Boolean);
    const year = Number(r.pubdate?.slice(0, 4)) || undefined;
    const doi = r.doi || r.elocationid?.match(/doi:\s*(.+)/i)?.[1];
    const title = r.title.replace(/\.$/, "");
    const hit: Omit<PaperHit, "bibtex" | "source"> & { sourceType: string } = {
      title,
      authors,
      year,
      venue: r.fulljournalname,
      doi,
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      sourceType: "PubMed",
    };
    hits.push({ ...hit, source: "pubmed", bibtex: toBibtex(hit) });
  }
  return hits;
}

/** Fetch a single PubMed abstract by PMID (E-utilities efetch, plain text). */
export async function getPubMedAbstract(
  pmid: string,
): Promise<{ pmid: string; abstract: string } | null> {
  const text = await fetchText(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${encodeURIComponent(
      pmid,
    )}&rettype=abstract&retmode=text`,
  );
  if (!text.trim()) return null;
  return { pmid, abstract: text.slice(0, 4000) };
}

// ---------------------------------------------------------------------------
// Europe PMC
// ---------------------------------------------------------------------------
export async function searchEuropePmc(
  query: string,
  limit = 8,
): Promise<PaperHit[]> {
  const data = (await fetchJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(
      query,
    )}&resultType=core&format=json&pageSize=${limit}`,
  )) as {
    resultList?: {
      result?: Array<{
        title?: string;
        authorString?: string;
        journalTitle?: string;
        pubYear?: string;
        doi?: string;
        abstractText?: string;
        citedByCount?: number;
        pmid?: string;
        fullTextUrlList?: {
          fullTextUrl?: Array<{ url?: string; availability?: string }>;
        };
      }>;
    };
  };
  const results = data.resultList?.result ?? [];
  return results
    .filter((r) => r.title)
    .map((r) => {
      const authors = (r.authorString || "")
        .split(/,\s*|\sand\s/)
        .map((a) => a.trim())
        .filter(Boolean);
      const year = Number(r.pubYear) || undefined;
      const hit: Omit<PaperHit, "bibtex" | "source"> & { sourceType: string } = {
        title: r.title!.replace(/\.$/, ""),
        authors,
        year,
        venue: r.journalTitle,
        doi: r.doi,
        url: r.doi
          ? `https://doi.org/${r.doi}`
          : r.pmid
            ? `https://europepmc.org/article/MED/${r.pmid}`
            : undefined,
        abstract: cleanAbstract(r.abstractText),
        citationCount: r.citedByCount,
        sourceType: "Europe PMC",
      };
      return { ...hit, source: "europepmc" as const, bibtex: toBibtex(hit) };
    });
}

// ---------------------------------------------------------------------------
// OpenAlex
// ---------------------------------------------------------------------------
export async function searchOpenAlex(
  query: string,
  limit = 8,
): Promise<PaperHit[]> {
  const data = (await fetchJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(
      query,
    )}&per-page=${limit}&select=title,authorships,publication_year,primary_location,doi,cited_by_count,abstract_inverted_index`,
  )) as {
    results?: Array<{
      title?: string;
      authorships?: Array<{ author?: { display_name?: string } }>;
      publication_year?: number;
      primary_location?: {
        source?: { display_name?: string } | null;
        landing_page_url?: string | null;
      } | null;
      doi?: string;
      cited_by_count?: number;
      abstract_inverted_index?: Record<string, number[]> | null;
    }>;
  };
  const results = data.results ?? [];
  return results
    .filter((r) => r.title)
    .map((r) => {
      // Rebuild abstract from inverted index
      let abstract: string | undefined;
      if (r.abstract_inverted_index) {
        const words: Array<{ pos: number; w: string }> = [];
        for (const [w, positions] of Object.entries(r.abstract_inverted_index)) {
          for (const pos of positions) words.push({ pos, w });
        }
        words.sort((a, b) => a.pos - b.pos);
        abstract = words.map((x) => x.w).join(" ").slice(0, 1500) || undefined;
      }
      const authors = (r.authorships ?? [])
        .map((a) => a.author?.display_name || "")
        .filter(Boolean);
      const doi = r.doi?.replace("https://doi.org/", "");
      const hit: Omit<PaperHit, "bibtex" | "source"> & { sourceType: string } = {
        title: r.title!.replace(/\.$/, ""),
        authors,
        year: r.publication_year,
        venue: r.primary_location?.source?.display_name || undefined,
        doi,
        url: r.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : undefined),
        abstract,
        citationCount: r.cited_by_count,
        sourceType: "OpenAlex",
      };
      return { ...hit, source: "openalex" as const, bibtex: toBibtex(hit) };
    });
}

// ---------------------------------------------------------------------------
// Crossref
// ---------------------------------------------------------------------------
export async function searchCrossref(
  query: string,
  limit = 8,
): Promise<PaperHit[]> {
  const data = (await fetchJson(
    `https://api.crossref.org/works?query=${encodeURIComponent(
      query,
    )}&rows=${limit}&select=title,author,issued,container-title,DOI,abstract,is-referenced-by-count,URL`,
  )) as {
    message?: {
      items?: Array<{
        title?: string[];
        author?: Array<{ given?: string; family?: string }>;
        issued?: { "date-parts"?: Array<Array<number>> };
        "container-title"?: string[];
        DOI?: string;
        abstract?: string;
        "is-referenced-by-count"?: number;
        URL?: string;
      }>;
    };
  };
  const items = data.message?.items ?? [];
  return items
    .filter((r) => r.title?.[0])
    .map((r) => {
      const authors = (r.author ?? [])
        .map((a) => [a.given, a.family].filter(Boolean).join(" "))
        .filter(Boolean);
      const year = r.issued?.["date-parts"]?.[0]?.[0];
      const hit: Omit<PaperHit, "bibtex" | "source"> & { sourceType: string } = {
        title: r.title![0]!.replace(/\.$/, ""),
        authors,
        year,
        venue: r["container-title"]?.[0],
        doi: r.DOI,
        url: r.URL || (r.DOI ? `https://doi.org/${r.DOI}` : undefined),
        abstract: cleanAbstract(r.abstract),
        citationCount: r["is-referenced-by-count"],
        sourceType: "Crossref",
      };
      return { ...hit, source: "crossref" as const, bibtex: toBibtex(hit) };
    });
}

// ---------------------------------------------------------------------------
// Tavily (general web search) — optional, requires a user-provided API key.
// The key is read from (in order): TAVILY_API_KEY env → App data dir config.
// It is NEVER hardcoded here and never shipped inside the .app bundle, so
// distributed DMGs have no embedded credentials; each user brings their own.
// ---------------------------------------------------------------------------
function loadTavilyKey(): string | null {
  if (process.env.TAVILY_API_KEY) return process.env.TAVILY_API_KEY;
  // Desktop app data dir (matches Tauri's app_local_data_dir)
  const candidates = [
    process.env.TAVILY_KEY_FILE,
    pathMod.join(
      process.env.HOME || "/Users/Shared",
      "Library/Application Support/com.yiyabo.desktop/tavily.key",
    ),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      const v = fsSync.readFileSync(p, "utf8").trim();
      if (v) return v;
    } catch {
      /* file missing — fine */
    }
  }
  return null;
}

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

export async function searchWeb(
  query: string,
  limit = 5,
): Promise<Array<{ title: string; url: string; snippet: string; score: number }> | null> {
  const apiKey = loadTavilyKey();
  if (!apiKey) return null; // not configured — tool reports itself as unavailable

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.min(10, Math.max(1, limit)),
        search_depth: "basic",
        include_answer: false,
      }),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = (await res.json()) as { results?: TavilyResult[] };
    return (data.results ?? []).map((r) => ({
      title: r.title || "(untitled)",
      url: r.url || "",
      snippet: (r.content || "").replace(/\s+/g, " ").slice(0, 400),
      score: r.score ?? 0,
    }));
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Unified entry
// ---------------------------------------------------------------------------
export type ResearchSearchResult = {
  query: string;
  sources: Array<{ source: string; count: number; error?: string }>;
  papers: PaperHit[];
};

/** Search all sources in parallel; tolerate individual failures. */
export async function searchAllSources(
  query: string,
  limitPerSource = 5,
): Promise<ResearchSearchResult> {
  const jobs: Array<{ source: PaperHit["source"]; run: Promise<PaperHit[]> }> = [
    { source: "pubmed", run: searchPubMed(query, limitPerSource) },
    { source: "europepmc", run: searchEuropePmc(query, limitPerSource) },
    { source: "openalex", run: searchOpenAlex(query, limitPerSource) },
    { source: "crossref", run: searchCrossref(query, limitPerSource) },
  ];

  const settled = await Promise.allSettled(jobs.map((j) => j.run));
  const papers: PaperHit[] = [];
  const sources: ResearchSearchResult["sources"] = [];

  settled.forEach((res, i) => {
    const { source } = jobs[i]!;
    if (res.status === "fulfilled") {
      sources.push({ source, count: res.value.length });
      papers.push(...res.value);
    } else {
      sources.push({
        source,
        count: 0,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });

  return { query, sources, papers };
}
