/**
 * Search query pipeline suites — executed in plain Node against COMPILED
 * sources (no network, no YouTube quota). Verifies the API-handler boundary
 * (Zod schema = exactly what /api/youtube/search parses), the blank-gate,
 * single-encoding URL serialization, and that fallback helpers are intact.
 */
import {
  isSubmittableQuery,
  roundTripSearchParam,
} from "../../src/lib/search/query-pipeline";
import {
  shuffleOneWord,
  shuffleWords,
  splitGraphemes,
  trimSpaces,
} from "../../src/lib/search/query-transforms";
import { YouTubeSearchSettingsSchema } from "../../src/lib/validation/youtube-schemas";
import {
  cleanQueryString,
  generateRelaxedSubqueries,
} from "../../src/lib/platforms/youtube/youtube-search-service";

let passed = 0;
export function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) throw new Error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  passed += 1;
  console.log(`  ok: ${name}`);
}
export function passCount(): number {
  return passed;
}

const BASE_SETTINGS = {
  types: ["video"],
  pageSize: 25,
  maxPages: 1,
  maxItems: 25,
  order: "relevance",
  safeSearch: "none",
  videoDuration: "any",
  videoDefinition: "any",
  videoCaption: "any",
  videoEmbeddable: "any",
} as const;

function parseQuery(query: unknown): string | null {
  const parsed = YouTubeSearchSettingsSchema.safeParse({ ...BASE_SETTINGS, query });
  if (!parsed.success) return null;
  return parsed.data.query;
}

export async function suiteQueryAcceptance(): Promise<void> {
  console.log("\n[ query acceptance — verbatim through the API boundary ]");
  const corpus: Array<[string, string]> = [
    ["plain English", "lofi hip hop radio beats to relax"],
    ["arabic", "أفضل فيديوهات 2026 🔬"],
    ["emoji only", "🔥🔥🔥 😂❤️"],
    ["mixed scripts", "C++ vs C# 🤖 paired with possède résumé"],
    ["arabic-indic numerals", "حلقة ٢٠٢٦ الجزء ٣"],
    ["punctuation/specials", "hello @world #AI $100"],
    ["quotes/apostrophes", `"machine learning" -tutorial it's 50% + 2 = ?`],
    ["repeated punctuation", "what??? really!!! ... --- ___"],
    ["slashes/brackets", "A/B testing: C\\D [live] {4K} <official>"],
    ["zwj emoji sequence", "👨‍👩‍👧 family test"],
  ];
  for (const [name, input] of corpus) {
    const out = parseQuery(input);
    check(`schema accepts ${name} verbatim`, out === input, JSON.stringify(out)?.slice(0, 80));
  }
  // Long query: no app-level truncation (1500 chars incl. emoji + Arabic).
  const long = `بحث طويل ${"🎬".repeat(50)} `.repeat(40).slice(0, 1500);
  const longOut = parseQuery(long);
  check("long query preserved exactly", longOut === long, `len in=${long.length} out=${longOut?.length ?? -1}`);
}

export async function suiteQueryRejection(): Promise<void> {
  console.log("\n[ rejection — empty/blank/non-string, constraints intact ]");
  check("empty rejected", parseQuery("") === null);
  check("whitespace-only rejected", parseQuery("   \t\n  ") === null);
  check("non-string rejected", parseQuery(42) === null && parseQuery(null) === null);
  check("leading/trailing spaces preserved", parseQuery("  padded query  ") === "  padded query  ");
  // Existing legitimate constraints still enforced.
  const badTypes = YouTubeSearchSettingsSchema.safeParse({ ...BASE_SETTINGS, query: "x", types: ["nope"] });
  check("bad resource type rejected", !badTypes.success);
  const badPage = YouTubeSearchSettingsSchema.safeParse({ ...BASE_SETTINGS, query: "x", pageSize: 999 });
  check("pageSize bound intact", !badPage.success);
  // Submission gate mirrors the component's submit guard.
  check("gate: blank blocked", !isSubmittableQuery("   "));
  check("gate: empty blocked", !isSubmittableQuery(""));
  check("gate: real query passes untouched", isSubmittableQuery("  C++ 🤖  "));
}

export async function suiteSerialization(): Promise<void> {
  console.log("\n[ serialization — single encoding, no mutation ]");
  const samples = [
    "C++ vs C# 🤖",
    "أفضل فيديوهات 2026 🔬",
    `"machine learning" -tutorial`,
    "hello @world #AI $100 & 50%",
    "A/B testing: 50% + 2 = ?",
    "a+b plus sign",
    "spaces  and\ttabs",
    "👨‍👩‍👧‍👦 joined emoji",
  ];
  for (const s of samples) {
    check(`round-trip: ${s.slice(0, 24)}`, roundTripSearchParam(s) === s);
  }
  // Double-encoding WOULD corrupt — our path must never do this.
  const once = encodeURIComponent("C++ 🤖");
  const twice = encodeURIComponent(once);
  check("double-encoding differs (guard documented)", twice !== once);
  check("plus survives literally", roundTripSearchParam("a+b") === "a+b");
}

export async function suiteFallbackIntact(): Promise<void> {
  console.log("\n[ fallback helpers intact (zero-result recovery path) ]");
  // cleanQueryString still exists for fallback candidates + scoring only.
  check("fallback cleaner strips quotes", cleanQueryString(`"hello" 'world'`) === "hello world");
  const cands = generateRelaxedSubqueries("one two three four five six seven");
  check("relaxed candidates generated", cands.length > 0 && cands.every((c) => c.length >= 3));
  const empty = generateRelaxedSubqueries("hi");
  check("short query yields no candidates", empty.length === 0);
}

const STUB_ZERO: () => number = () => 0;
const tokensOf = (q: string): string[] => (q.match(/\S+/g) ?? []);

export async function suiteShuffleWords(): Promise<void> {
  console.log("\n[ shuffle words ]");
  // Deterministic stub random (always 0): Fisher-Yates rotates predictably.
  const r = shuffleWords("machine learning tutorials 2026", STUB_ZERO);
  check("shuffles order", r.changed && r.query === "learning tutorials 2026 machine");
  check("preserves multiset", tokensOf(r.query).sort().join("|") === tokensOf("machine learning tutorials 2026").sort().join("|"));
  // Attached punctuation travels with its token.
  const p = shuffleWords("hello @world #AI!", STUB_ZERO);
  check("punctuation attached", p.changed && tokensOf(p.query).sort().join("|") === "#AI!|@world|hello");
  // Arabic + emoji + internal spacing preserved exactly.
  const ar = "  مرحبا   بالعالم 🌍 test  ";
  const arR = shuffleWords(ar, STUB_ZERO);
  check("unicode + spacing preserved", arR.changed && tokensOf(arR.query).sort().join("|") === tokensOf(ar).sort().join("|"));
  check("separators untouched", arR.query.replace(/\S+/g, "#") === ar.replace(/\S+/g, "#"));
  // No-ops: single token and blank.
  const one = shuffleWords("lonely", STUB_ZERO);
  check("single word no-op + message", !one.changed && one.query === "lonely" && Boolean(one.message));
  const same = shuffleWords("same same same", STUB_ZERO);
  check("identical words no-op", !same.changed && same.query === "same same same");
  // Property: random runs over distinct words eventually differ (bounded attempts here).
  let differed = false;
  for (let i = 0; i < 10; i += 1) {
    if (shuffleWords("alpha beta gamma delta").query !== "alpha beta gamma delta") {
      differed = true;
      break;
    }
  }
  check("random shuffle differs", differed);
}

export async function suiteTrimSpaces(): Promise<void> {
  console.log("\n[ trim spaces ]");
  check("native trim baseline", trimSpaces("   machine    learning   tutorials  ").query === "machine    learning   tutorials");
  check("changed flag", trimSpaces("  x  ").changed === true);
  check("tabs/newlines trimmed", trimSpaces("\t\n hello \n").query === "hello");
  check("nbsp trimmed", trimSpaces(" hello ").query === "hello");
  const noop = trimSpaces("already clean 🤖!");
  check("no-op message, no search", !noop.changed && noop.query === "already clean 🤖!" && Boolean(noop.message));
  check("internal content untouched", trimSpaces("  a  b  ").query === "a  b");
}

export async function suiteShuffleOneWord(): Promise<void> {
  console.log("\n[ shuffle one word ]");
  // Stub random picks deterministically: first eligible word, rotated clusters.
  const r = shuffleOneWord("machine learning tutorials", STUB_ZERO);
  check("one word shuffled", r.changed);
  const before = tokensOf("machine learning tutorials");
  const after = tokensOf(r.query);
  check("word count preserved", after.length === 3);
  const changedIdx = after.findIndex((w, i) => w !== before[i]);
  check("exactly one word changed", changedIdx >= 0 && after.filter((w, i) => w !== before[i]).length === 1);
  check(
    "grapheme multiset preserved",
    splitGraphemes(after[changedIdx]).clusters.sort().join("|") ===
      splitGraphemes(before[changedIdx]).clusters.sort().join("|"),
  );
  // Positions of the other words are byte-identical.
  check("neighbors untouched", r.query.replace(after[changedIdx], "#") === "machine learning tutorials".replace(before[changedIdx], "#"));
  // Arabic word: code points preserved, order changed.
  const ar = shuffleOneWord("مرحبا بالعالم", STUB_ZERO);
  check("arabic eligible shuffled", ar.changed && [...ar.query].sort().join("") === [..."مرحبا بالعالم"].sort().join(""));
  // Emoji family (single grapheme) can never be the eligible word alone.
  const fam = shuffleOneWord("👨‍👩‍👧 test", STUB_ZERO);
  if (fam.changed) {
    check("family emoji intact when shuffled around", fam.query.includes("👨‍👩‍👧"));
  } else {
    check("family-only no-op safe", fam.query === "👨‍👩‍👧 test");
  }
  // Ineligible queries explain instead of searching.
  for (const q of ["a b c", "aaa bbb", "x", "   "]) {
    const res = shuffleOneWord(q, STUB_ZERO);
    check(`ineligible no-op: ${JSON.stringify(q)}`, !res.changed && res.query === q && Boolean(res.message));
  }
}
