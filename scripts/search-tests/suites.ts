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
  // Standalone quoted phrases travel as a single unit.
  const q = shuffleWords('"machine learning" tutorials 2026', STUB_ZERO);
  check("quoted phrase kept intact", q.changed && q.query.includes('"machine learning"'));
  check("quoted phrase multiset", tokensOf(q.query.replace(/"machine learning"/g, "QUOTED")).sort().join("|") === "2026|QUOTED|tutorials");
  const qar = shuffleWords('"تعلم بايثون" دروس 2026', STUB_ZERO);
  check("arabic quoted phrase kept intact", qar.changed && qar.query.includes('"تعلم بايثون"'));
  // No-ops: single token and blank.
  const one = shuffleWords("lonely", STUB_ZERO);
  check("single word no-op + message", !one.changed && one.query === "lonely" && Boolean(one.message));
  const blank = shuffleWords("   ", STUB_ZERO);
  check("blank no-op + message", !blank.changed && blank.query === "   " && Boolean(blank.message));
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
  // Property: repeated clicks use fresh randomness (stub sequences differ).
  const seqA = shuffleWords("one two three four", () => 0.1);
  const seqB = shuffleWords("one two three four", () => 0.9);
  check("fresh permutation per random source", seqA.query !== seqB.query || (!seqA.changed && !seqB.changed));
}

export async function suiteTrimSpaces(): Promise<void> {
  console.log("\n[ trim spaces ]");
  check("outer trim + inner collapse", trimSpaces("   machine    learning   tutorials  ").query === "machine learning tutorials");
  check("task example", trimSpaces("   molecular     biology   practical   ").query === "molecular biology practical");
  check("operators intact", trimSpaces("  iPhone 15|iPhone 16 -case  ").query === "iPhone 15|iPhone 16 -case");
  check("changed flag", trimSpaces("  x  ").changed === true);
  check("tabs/newlines collapsed", trimSpaces("\t\n hello \n world \n").query === "hello world");
  check("nbsp trimmed", trimSpaces(" hello ").query === "hello");
  const noop = trimSpaces("already clean 🤖!");
  check("no-op message, no search", !noop.changed && noop.query === "already clean 🤖!" && Boolean(noop.message));
  check("quotes and minus preserved", trimSpaces('  "exact phrase" -excluded  ').query === '"exact phrase" -excluded');
  check("empty safe", trimSpaces("").query === "" && !trimSpaces("").changed);
  check("whitespace-only safe", trimSpaces("   ").query === "" && typeof trimSpaces("   ").changed === "boolean");
}

export async function suiteShuffleOneWord(): Promise<void> {
  console.log("\n[ shuffle one word — first-three-graphemes preserved ]");
  // Stub random picks deterministically; suffix order is a Fisher–Yates rotation.
  const r = shuffleOneWord("machine learning tutorials", STUB_ZERO);
  check("one word shuffled", r.changed);
  const before = tokensOf("machine learning tutorials");
  const after = tokensOf(r.query);
  check("word count preserved", after.length === 3);
  const changedIdx = after.findIndex((w, i) => w !== before[i]);
  check("exactly one word changed", changedIdx >= 0 && after.filter((w, i) => w !== before[i]).length === 1);
  // Mandatory prefix rule: first three grapheme clusters byte-identical.
  const beforeClusters = splitGraphemes(before[changedIdx]).clusters;
  const afterClusters = splitGraphemes(after[changedIdx]).clusters;
  check("word length preserved", afterClusters.length === beforeClusters.length);
  check(
    "first three graphemes unchanged",
    afterClusters.slice(0, 3).join("") === beforeClusters.slice(0, 3).join(""),
  );
  check(
    "suffix multiset preserved",
    [...afterClusters.slice(3)].sort().join("|") === [...beforeClusters.slice(3)].sort().join("|"),
  );
  check("suffix order differs", afterClusters.slice(3).join("") !== beforeClusters.slice(3).join(""));
  // Positions of the other words are byte-identical.
  check("neighbors untouched", r.query.replace(after[changedIdx], "#") === "machine learning tutorials".replace(before[changedIdx], "#"));
  // Spacing around the changed word is preserved exactly.
  const spaced = shuffleOneWord("  machine   learning  ", STUB_ZERO);
  check("spacing preserved", spaced.changed && spaced.query.replace(/\S+/g, "#") === "  machine   learning  ".replace(/\S+/g, "#"));
  // Arabic word: prefix clusters preserved, suffix reordered, code points intact.
  const ar = shuffleOneWord("مرحبا بالعالم", STUB_ZERO);
  check("arabic eligible shuffled", ar.changed && [...ar.query].sort().join("") === [..."مرحبا بالعالم"].sort().join(""));
  if (ar.changed) {
    const arBefore = tokensOf("مرحبا بالعالم");
    const arAfter = tokensOf(ar.query);
    const arIdx = arAfter.findIndex((w, i) => w !== arBefore[i]);
    const bCl = splitGraphemes(arBefore[arIdx]).clusters;
    const aCl = splitGraphemes(arAfter[arIdx]).clusters;
    check("arabic prefix preserved", aCl.slice(0, 3).join("") === bCl.slice(0, 3).join(""));
    check("arabic suffix differs", aCl.slice(3).join("") !== bCl.slice(3).join(""));
  }
  // Emoji family (single grapheme) can never be the eligible word alone.
  const fam = shuffleOneWord("👨‍👩‍👧 test", STUB_ZERO);
  if (fam.changed) {
    check("family emoji intact when shuffled around", fam.query.includes("👨‍👩‍👧"));
  } else {
    check("family-only no-op safe", fam.query === "👨‍👩‍👧 test");
  }
  // Accented/diacritic word: combining marks travel with their grapheme.
  const acc = shuffleOneWord("résumé expliqué", STUB_ZERO);
  if (acc.changed) {
    const accAfter = tokensOf(acc.query);
    const accIdx = accAfter.findIndex((w, i) => w !== tokensOf("résumé expliqué")[i]);
    const bCl = splitGraphemes(tokensOf("résumé expliqué")[accIdx]).clusters;
    const aCl = splitGraphemes(accAfter[accIdx]).clusters;
    check("accented prefix preserved", aCl.slice(0, 3).join("") === bCl.slice(0, 3).join(""));
  } else {
    check("accented no-op safe", acc.query === "résumé expliqué");
  }
  // Ineligible queries explain instead of searching: short words, uniform
  // suffixes, single chars, and blank input.
  for (const q of ["a b c", "aaa bbb", "x", "   ", "abc def", "abcaaaa"]) {
    const res = shuffleOneWord(q, STUB_ZERO);
    check(`ineligible no-op: ${JSON.stringify(q)}`, !res.changed && res.query === q && Boolean(res.message));
  }
  // Repeated clicks perform fresh randomization (stub sequences differ or both exhaust).
  let freshDiffers = false;
  for (let i = 0; i < 10; i += 1) {
    const a = shuffleOneWord("programming tutorial advanced", () => Math.random());
    const b = shuffleOneWord("programming tutorial advanced", () => Math.random());
    if (a.query !== b.query) {
      freshDiffers = true;
      break;
    }
  }
  check("fresh randomization across clicks", freshDiffers);
}
