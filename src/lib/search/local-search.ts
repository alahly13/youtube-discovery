import { Document as FlexSearchDocument } from "flexsearch";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Shared Local Search Service — one FlexSearch-backed abstraction for the
 * whole project (Saved Library, playlist contents, History, …).
 * ──────────────────────────────────────────────────────────────────────────
 * - Reuses the already-installed `flexsearch` dependency. No second search
 *   library was introduced.
 * - Strictly local: no YouTube API, no quota, no network, no SaaS.
 * - Title/name fields are weighted above long descriptions.
 * - The index is built once per dataset (memoize at the call site with
 *   `useMemo`) and reused across keystrokes; only the query re-runs.
 * - A dependency-free weighted fallback guarantees correct results even if
 *   FlexSearch fails to initialize in an edge runtime.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface SearchableDoc {
  id: string;
  /** Highest-weight field: titles, names, queries. */
  title: string;
  /** Medium-weight field: channel names, group names, resource/status. */
  subtitle?: string | null;
  /** Lowest-weight field: descriptions, notes, tags blob. */
  body?: string | null;
}

export interface RankedHit {
  id: string;
  score: number;
}

export interface LocalSearcher {
  /** Ranked ids, best first. Empty query returns [] (caller shows full list). */
  search: (query: string, limit?: number) => RankedHit[];
  size: number;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

/** Cheap subsequence fuzzy match: all query chars appear in order. */
function isSubsequence(query: string, target: string): boolean {
  if (query.length === 0) return true;
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target[ti] === query[qi]) qi += 1;
  }
  return qi === query.length;
}

function scoreDocFallback(doc: SearchableDoc, tokens: string[]): number {
  const title = normalize(doc.title);
  const subtitle = normalize(doc.subtitle);
  const body = normalize(doc.body);
  let score = 0;
  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();
    if (!token) continue;
    if (title.includes(token)) {
      score += title === token ? 30 : title.startsWith(token) ? 15 : 10;
    } else if (isSubsequence(token, title.replace(/[^a-z0-9]/g, ""))) {
      score += 4;
    }
    if (subtitle && subtitle.includes(token)) score += 5;
    else if (subtitle && isSubsequence(token, subtitle.replace(/[^a-z0-9]/g, ""))) score += 2;
    if (body && body.includes(token)) score += 2;
    // Multi-token phrase bonus across the whole haystack.
  }
  return score;
}

function fallbackSearch(docs: SearchableDoc[]) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  return {
    search: (query: string, limit = 200): RankedHit[] => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const tokens = q.split(/\s+/).filter(Boolean);
      const hits: RankedHit[] = [];
      for (const doc of docs) {
        const s = scoreDocFallback(doc, tokens);
        if (s > 0) hits.push({ id: doc.id, score: s });
      }
      // Strict AND for multi-token queries keeps huge libraries usable.
      const strict =
        tokens.length > 1
          ? hits.filter((h) => {
              const d = byId.get(h.id);
              if (!d) return false;
              const hay = `${d.title} ${d.subtitle ?? ""} ${d.body ?? ""}`.toLowerCase();
              return tokens.every(
                (t) => hay.includes(t) || isSubsequence(t, hay.replace(/[^a-z0-9]/g, "")),
              );
            })
          : hits;
      return strict.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    size: docs.length,
  } satisfies LocalSearcher;
}

/**
 * Builds a searcher over a dataset. Tries FlexSearch `Document` first
 * (forward tokenization gives prefix + typo tolerance); falls back to the
 * weighted matcher above on any failure. Callers must memoize per dataset.
 */
export function createLocalSearcher(docs: SearchableDoc[]): LocalSearcher {
  if (docs.length === 0) {
    return { search: () => [], size: 0 };
  }
  try {
    const index = new FlexSearchDocument<{
      id: string;
      title: string;
      subtitle: string;
      body: string;
    }>({
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: "forward", resolution: 9 },
          { field: "subtitle", tokenize: "forward", resolution: 5 },
          { field: "body", tokenize: "strict", resolution: 3 },
        ],
        store: false,
      },
      tokenize: "forward",
      cache: 64,
    });
    for (const d of docs) {
      index.add({
        id: d.id,
        title: d.title,
        subtitle: d.subtitle ?? "",
        body: d.body ?? "",
      });
    }
    const order = new Map(docs.map((d, i) => [d.id, i]));
    return {
      search: (query: string, limit = 200): RankedHit[] => {
        const q = query.trim();
        if (!q) return [];
        try {
          const raw = index.search(q, { enrich: true, limit }) as Array<{
            result: Array<{ id: string | number } | string | number>;
          }>;
          const scores = new Map<string, number>();
          // Earlier field buckets (title first) outrank later ones.
          raw.forEach((bucket, bucketIdx) => {
            const weight = raw.length - bucketIdx;
            for (const r of bucket.result ?? []) {
              const id = String(typeof r === "object" ? r.id : r);
              scores.set(id, (scores.get(id) ?? 0) + weight * 10);
            }
          });
          if (scores.size === 0) {
            return fallbackSearch(docs).search(q, limit);
          }
          return [...scores.entries()]
            .map(([id, score]) => ({ id, score }))
            .sort(
              (a, b) => b.score - a.score || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
            )
            .slice(0, limit);
        } catch {
          return fallbackSearch(docs).search(q, limit);
        }
      },
      size: docs.length,
    };
  } catch {
    return fallbackSearch(docs);
  }
}

/**
 * Ranked filter over original items. Returns items in relevance order for a
 * non-empty query, or the input order for an empty query. Never reorders the
 * caller's array in place.
 */
export function searchRanked<T>(
  items: T[],
  docs: SearchableDoc[],
  searcher: LocalSearcher | null,
  query: string,
  limit = 1000,
): T[] {
  if (!query.trim()) return items;
  const idToItem = new Map<string, T>();
  items.forEach((item, i) => {
    const doc = docs[i];
    if (doc) idToItem.set(doc.id, item);
  });
  const active = searcher ?? fallbackSearch(docs);
  const hits = active.search(query, limit);
  const out: T[] = [];
  for (const h of hits) {
    const item = idToItem.get(h.id);
    if (item !== undefined) out.push(item);
  }
  return out;
}

/* ── Dataset adapters (identity-preserving: docs carry the entity id) ── */

export function toSearchDoc(
  id: string,
  title: string,
  subtitle?: string | null,
  bodyParts?: Array<string | null | undefined>,
): SearchableDoc {
  return {
    id,
    title,
    subtitle: subtitle ?? undefined,
    body: (bodyParts ?? []).filter(Boolean).join("\n"),
  };
}
