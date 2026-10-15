/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Smart Query Transformations — explicit, user-invoked query rewrites.
 * ──────────────────────────────────────────────────────────────────────────
 * These run ONLY when the user clicks a transform button. Each returns the
 * new query (or a no-change message); the caller writes it to the visible
 * input ONLY and never submits, never calls the YouTube API, and never
 * touches search history. The user reviews/edits the transformed text and
 * presses the existing Search button (or Enter) explicitly when ready.
 *
 * - Shuffle Words: Fisher–Yates word reorder; standalone quoted phrases
 *   ("exact phrase") travel as one unit; separators stay fixed in place.
 * - Trim Spaces: trim outer whitespace + collapse every inner whitespace
 *   run to a single ordinary space; operators/punctuation untouched.
 * - Shuffle One Word: keep the first THREE grapheme clusters of one random
 *   eligible word, Fisher–Yates shuffle only the suffix clusters.
 * - Unicode-safe: whitespace-token split never breaks surrogate pairs;
 *   grapheme handling uses Intl.Segmenter with a code-point fallback.
 * - Randomness is injectable (`random` param) for deterministic tests; the
 *   UI passes Math.random for a fresh permutation on every click.
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

/** Fisher–Yates shuffle (pure: returns a new array, unbiased permutation). */
export function shuffledArray<T>(items: readonly T[], random: RandomFn = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Maximum fresh-shuffle attempts before accepting that no distinct order exists. */
const MAX_SHUFFLE_ATTEMPTS = 25;

interface TextUnit {
  text: string;
  start: number;
  end: number;
}

/**
 * Collect reorderable units: a standalone double-quoted phrase ("...") is
 * one unit so its internal word order survives; every other
 * whitespace-separated token is its own unit. An unbalanced quote falls
 * back to plain token behavior. Positions are UTF-16 spans used only for
 * whole-unit splicing (never splitting inside a unit).
 */
function collectShuffleUnits(query: string): TextUnit[] {
  const units: TextUnit[] = [];
  const unitRe = /"[^"]*"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = unitRe.exec(query)) !== null) {
    units.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return units;
}

/**
 * Shuffle Words: randomly reorder the query's word units.
 * - Each unit keeps its spelling, punctuation, and capitalization.
 * - Standalone quoted phrases ("exact phrase") move as a single unit.
 * - Separators (leading/trailing/repeated whitespace) stay fixed in place,
 *   so spacing is preserved exactly and no information is lost.
 * - Retries with a fresh permutation until the effective order differs
 *   (when any distinct arrangement exists); otherwise reports a no-op.
 */
export function shuffleWords(query: string, random: RandomFn = Math.random): QueryTransformResult {
  const units = collectShuffleUnits(query);
  if (units.length < 2) {
    return NO_CHANGE("Add at least two words to shuffle their order", query);
  }
  if (units.every((u) => u.text === units[0].text)) {
    return NO_CHANGE("Words are identical — no different order exists", query);
  }
  const texts = units.map((u) => u.text);
  for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt += 1) {
    const reordered = shuffledArray(texts, random);
    const same = reordered.every((w, k) => w === texts[k]);
    if (!same) {
      // Splice shuffled units back into their original slots; every
      // whitespace separator between them stays byte-identical.
      const next =
        query.slice(0, units[0].start) +
        reordered
          .map((text, k) => {
            const gapAfter = k < units.length - 1 ? query.slice(units[k].end, units[k + 1].start) : "";
            return text + gapAfter;
          })
          .join("") +
        query.slice(units[units.length - 1].end);
      return { changed: true, query: next };
    }
  }
  return NO_CHANGE("Words are identical — no different order exists", query);
}

/**
 * Trim Spaces: strip leading/trailing whitespace and collapse every inner
 * whitespace run (spaces, tabs, newlines, NBSP) to a single ordinary space.
 * Spelling, capitalization, punctuation, word order, and search operators
 * (-, |, quotes, intitle:) are preserved byte-for-byte. Empty input is
 * returned safely without errors. Runs only on explicit button click —
 * never on keystroke, page load, or submission.
 */
export function trimSpaces(query: string): QueryTransformResult {
  if (query.length === 0) {
    return NO_CHANGE("Query is empty — nothing to trim", query);
  }
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized === query) {
    return NO_CHANGE("No extra spaces to remove", query);
  }
  return { changed: true, query: normalized };
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

/** Number of leading grapheme clusters that are never shuffled. */
export const SHUFFLE_ONE_WORD_PREFIX_SIZE = 3;

interface EligibleWord {
  word: string;
  start: number;
  end: number;
  /** First three grapheme clusters — copied verbatim, never shuffled. */
  prefix: string;
  /** Remaining grapheme clusters — the only shuffled material. */
  suffix: string[];
}

/**
 * Shuffle One Word: pick one random ELIGIBLE word and shuffle ONLY the
 * grapheme clusters after its first three, leaving the prefix, every other
 * word, and all spacing exactly in place.
 * - Eligibility: the word has more than three grapheme clusters AND its
 *   suffix holds at least two distinct clusters (so a visible change is
 *   possible). Ineligible words are skipped, never mangled.
 * - Surrogate pairs, combining marks, and emoji sequences are never split:
 *   segmentation is grapheme-based (Intl.Segmenter) with a code-point
 *   fallback that at minimum keeps surrogate pairs intact.
 * - Both the word pick and the suffix order use fresh Fisher–Yates
 *   shuffles; suffix no-ops are retried, then the next eligible word is
 *   tried, until a visible change is produced or every option is proven
 *   exhausted (no-op message, input untouched).
 */
export function shuffleOneWord(query: string, random: RandomFn = Math.random): QueryTransformResult {
  const candidates: EligibleWord[] = [];
  const tokenRe = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(query)) !== null) {
    const { clusters } = splitGraphemes(match[0]);
    if (clusters.length <= SHUFFLE_ONE_WORD_PREFIX_SIZE) continue;
    const suffix = clusters.slice(SHUFFLE_ONE_WORD_PREFIX_SIZE);
    if (distinctClusterCount(suffix) < 2) continue;
    candidates.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
      prefix: clusters.slice(0, SHUFFLE_ONE_WORD_PREFIX_SIZE).join(""),
      suffix,
    });
  }
  if (candidates.length === 0) {
    return NO_CHANGE(
      "No eligible word to shuffle — need a word with at least two different characters after its first three",
      query,
    );
  }
  const order = shuffledArray(candidates, random);
  for (const candidate of order) {
    const originalSuffix = candidate.suffix.join("");
    for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt += 1) {
      const reordered = shuffledArray(candidate.suffix, random);
      if (reordered.join("") !== originalSuffix) {
        const nextWord = candidate.prefix + reordered.join("");
        return {
          changed: true,
          query: query.slice(0, candidate.start) + nextWord + query.slice(candidate.end),
        };
      }
    }
  }
  return NO_CHANGE("No meaningful shuffle possible for these words", query);
}
