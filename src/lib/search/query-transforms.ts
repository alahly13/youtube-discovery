/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Smart Query Transformations — explicit, user-invoked query rewrites.
 * ──────────────────────────────────────────────────────────────────────────
 * These run ONLY when the user clicks a transform button. They are the
 * opposite of silent pipeline mutation: each returns the new query (or a
 * no-change message), the caller writes it to the visible input AND passes
 * it explicitly to the search function, so the submitted query always
 * matches the input. The downstream pipeline then transmits it verbatim.
 *
 * - Unicode-safe throughout: tokens split on whitespace runs (never inside
 *   surrogate pairs); grapheme shuffling uses Intl.Segmenter with a
 *   code-point fallback (fallback may split ZWJ/joiner sequences — noted).
 * - Randomness is injectable (`random` param) for deterministic tests; the
 *   UI uses Math.random.
 * Pure module: unit-testable in plain Node.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface QueryTransformResult {
  changed: boolean;
  query: string;
  /** Human-readable note for no-op cases (shown subtly, no search fired). */
  message?: string;
}

export type RandomFn = () => number;

const NO_CHANGE = (message: string, query: string): QueryTransformResult => ({
  changed: false,
  query,
  message,
});

/** Fisher–Yates shuffle (pure: returns a new array). */
export function shuffledArray<T>(items: readonly T[], random: RandomFn = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Shuffle Words: randomly reorder whitespace-separated tokens.
 * Words keep spelling + attached punctuation; separators stay in place so
 * internal spacing is preserved exactly. Retries until the order differs
 * (when any distinct arrangement exists); otherwise reports a no-op.
 */
export function shuffleWords(query: string, random: RandomFn = Math.random): QueryTransformResult {
  const parts = query.split(/(\s+)/);
  const wordIndices: number[] = [];
  parts.forEach((part, i) => {
    if (!/^\s*$/.test(part) && part.length > 0) wordIndices.push(i);
  });
  if (wordIndices.length < 2) {
    return NO_CHANGE("Add at least two words to shuffle their order", query);
  }
  const words = wordIndices.map((i) => parts[i]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const reordered = shuffledArray(words, random);
    const same = reordered.every((w, k) => w === words[k]);
    if (!same) {
      const next = [...parts];
      wordIndices.forEach((partIdx, k) => {
        next[partIdx] = reordered[k];
      });
      return { changed: true, query: next.join("") };
    }
  }
  return NO_CHANGE("Words are identical — no different order exists", query);
}

/**
 * Trim Spaces: native trim() baseline — strips leading/trailing whitespace
 * (including Unicode whitespace), preserves everything else byte-for-byte.
 * No-change → message, no search.
 */
export function trimSpaces(query: string): QueryTransformResult {
  const trimmed = query.trim();
  if (trimmed === query) {
    return NO_CHANGE("No extra outer spaces to remove", query);
  }
  return { changed: true, query: trimmed };
}

/** Split a string into grapheme clusters (emoji-safe) with fallback. */
export function splitGraphemes(text: string): { clusters: string[]; exact: boolean } {
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return { clusters: Array.from(segmenter.segment(text), (s) => s.segment), exact: true };
    }
  } catch {
    // Fall through to code-point segmentation below.
  }
  return { clusters: Array.from(text), exact: false };
}

/** Distinct-cluster count (eligibility: ≥2 distinct shuffle-able units). */
export function distinctClusterCount(clusters: string[]): number {
  return new Set(clusters).size;
}

interface WordSpan {
  word: string;
  start: number;
  end: number;
}

/**
 * Shuffle One Word: pick one random ELIGIBLE word (≥2 distinct grapheme
 * clusters) and shuffle its characters, leaving every other word and all
 * spacing/punctuation exactly in place. Surrogate pairs are never split
 * (code-point fallback at minimum); ZWJ sequences survive intact when
 * Intl.Segmenter is available. Retries words/shuffles until visible change
 * is possible; otherwise reports a no-op.
 */
export function shuffleOneWord(query: string, random: RandomFn = Math.random): QueryTransformResult {
  const spans: WordSpan[] = [];
  const tokenRe = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(query)) !== null) {
    spans.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  const eligible = spans.filter((s) => distinctClusterCount(splitGraphemes(s.word).clusters) >= 2);
  if (eligible.length === 0) {
    return NO_CHANGE("No eligible word to shuffle — need a word with at least two different characters", query);
  }
  const order = shuffledArray(eligible, random);
  for (const span of order) {
    const { clusters } = splitGraphemes(span.word);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const reordered = shuffledArray(clusters, random);
      if (reordered.join("") !== span.word) {
        return {
          changed: true,
          query: query.slice(0, span.start) + reordered.join("") + query.slice(span.end),
        };
      }
    }
  }
  return NO_CHANGE("No meaningful shuffle possible for these words", query);
}
