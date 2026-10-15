import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/search-guide/copy-button";

export const metadata: Metadata = {
  title: "Search Guide 2026 — YouTube Search Techniques",
  description:
    "Practical reference for YouTube search operators, structured API filters, and query utilities: what is documented, what is experimental, and what must be set as a filter instead.",
};

/* ═════════════════════════════════════════════════════════════════════════
   Search Guide 2026 — static reference page (server component).
   ─────────────────────────────────────────────────────────────────────────
   Accuracy contract: every technique carries exactly one support badge —
   Documented (official YouTube Data API v3 search.list syntax), Experimental
   (may work on youtube.com but not guaranteed through this app's API
   provider), or Structured filter (set in the app's search options, never
   typed as free text). No trick found online is presented as official.
   Arabic explanations (dir="rtl") pair with English operators/examples
   (dir="ltr", copyable). Black-and-white hierarchy via design tokens only.
   ═════════════════════════════════════════════════════════════════════════ */

function SupportBadge({ kind }: { kind: "documented" | "experimental" | "structured" }) {
  if (kind === "documented") return <Badge tone="success">Documented API syntax</Badge>;
  if (kind === "structured") return <Badge tone="primary">Structured filter</Badge>;
  return <Badge tone="warning">Experimental · interface-dependent</Badge>;
}

/* Code-like operator/example row: LTR, mono, copyable, wraps on mobile. */
function Example({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-2">
      <code dir="ltr" lang="en" className="min-w-0 flex-1 break-all font-mono text-[13px] text-foreground">
        {text}
      </code>
      <CopyButton text={text} label={label} />
    </div>
  );
}

function Ar({ children }: { children: ReactNode }) {
  return (
    <p dir="rtl" lang="ar" className="text-sm leading-7 text-muted">
      {children}
    </p>
  );
}

const TOC: { href: string; label: string }[] = [
  { href: "#utilities", label: "0 · أدوات الاستعلام" },
  { href: "#exact-phrase", label: "A · العبارة الدقيقة" },
  { href: "#exclude", label: "B · استبعاد الكلمات" },
  { href: "#or", label: "C · البدائل (OR)" },
  { href: "#plus", label: "D · علامة الزائد" },
  { href: "#content-type", label: "E · نوع المحتوى والجودة" },
  { href: "#intitle", label: "F · البحث في العنوان" },
  { href: "#structured", label: "G · الفلاتر الرسمية" },
  { href: "#templates", label: "H · قوالب جاهزة" },
  { href: "#references", label: "I · روابط مرجعية" },
];

export default function SearchGuidePage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={BookOpen}
        eyebrow="Reference · 2026"
        title="Search Guide 2026 — YouTube Search Techniques"
        description="Your reusable reference for search operators and filters. Each technique is labeled honestly: documented API syntax, experimental interface behavior, or a structured filter you set in Search options instead of typing."
      >
        {/* ── How to read this guide ─────────────────────────────── */}
        <Card>
          <CardHeader title="How to read the labels" eyebrow="Accuracy first" />
          <div className="flex flex-wrap gap-2">
            <SupportBadge kind="documented" />
            <SupportBadge kind="experimental" />
            <SupportBadge kind="structured" />
          </div>
          <div className="mt-4 space-y-2 text-sm text-muted">
            <p>
              <strong className="text-foreground">Documented API syntax</strong> — explicitly supported by the official
              YouTube Data API v3 <code dir="ltr">search.list</code> <code dir="ltr">q</code> parameter. Safe to rely
              on through this app.
            </p>
            <p>
              <strong className="text-foreground">Experimental · interface-dependent</strong> — may work on youtube.com
              or in some search experiences, but is <strong className="text-foreground">not guaranteed</strong> through
              this app&apos;s API provider. Try it, verify the results, never assume.
            </p>
            <p>
              <strong className="text-foreground">Structured filter</strong> — a setting or API parameter configured in
              the app&apos;s Search options (or sent as its own parameter). Typing it as free text alone is not enough.
            </p>
          </div>
          <nav aria-label="Guide sections" className="mt-4 flex flex-wrap gap-2">
            {TOC.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:border-primary/50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </Card>

        {/* ── 0 · Query utilities ────────────────────────────────── */}
        <Card id="utilities" className="scroll-mt-24">
          <CardHeader title="Query utilities on the Search bar" eyebrow="Built into this app" />
          <Ar>
            أزرار تحسين الاستعلام أسفل شريط البحث تُعدِّل النص داخل نفس الحقل فقط، ولا تُنفِّذ أي بحث تلقائيًا. راجع
            النتيجة أو عدِّلها، ثم اضغط زر البحث يدويًا عندما تكون جاهزًا.
          </Ar>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
            <li>
              <strong className="text-foreground">Shuffle Words</strong> — randomly reorders the words (
              <span dir="rtl" lang="ar">
                مع الحفاظ على العبارات المقتبسة كوحدة واحدة
              </span>
              ). Nothing is searched until you press Search.
            </li>
            <li>
              <strong className="text-foreground">Trim Spaces</strong> — removes outer whitespace and collapses repeated
              inner spaces to one (
              <span dir="rtl" lang="ar">
                مثال: المسافات الزائدة تُدمج دون تغيير الكلمات أو الرموز
              </span>
              ).
            </li>
            <li>
              <strong className="text-foreground">Shuffle One Word</strong> — shuffles the characters{" "}
              <em>after the first three</em> of one randomly picked eligible word (
              <span dir="rtl" lang="ar">
                أول ثلاثة أحرف تبقى كما هي دائمًا
              </span>
              ).
            </li>
          </ul>
        </Card>

        {/* ── A · Exact phrase ───────────────────────────────────── */}
        <Card id="exact-phrase" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SupportBadge kind="experimental" />
          </div>
          <CardHeader title="A · Exact-phrase searching" eyebrow={'Operator: "exact phrase"'} />
          <div className="space-y-3">
            <Example text={'"تعلم لغة بايثون للمبتدئين"'} label="exact phrase example" />
            <Ar>
              علامات الاقتباس تُستخدم عادةً لطلب عبارة حرفية، لكن النتائج قد تختلف من واجهة لأخرى، والمطابقة الدقيقة
              غير مضمونة عبر كل واجهات البحث أو عبر موفّر البحث في هذا التطبيق. جرّبها وقارن النتائج، ولا تعتبرها قاعدة
              رسمية مضمونة في واجهة الـ API.
            </Ar>
            <p className="text-sm text-muted">
              In this app: quotes are sent verbatim inside the query (nothing strips them). If phrase results look
              loose, narrow them with a structured filter from section G instead.
            </p>
          </div>
        </Card>

        {/* ── B · Exclusion ──────────────────────────────────────── */}
        <Card id="exclude" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SupportBadge kind="documented" />
          </div>
          <CardHeader title="B · Excluding unwanted words" eyebrow="Operator: -word" />
          <div className="space-y-3">
            <Example text="شرح فوتوشوب -سريع" label="exclusion example" />
            <Ar>
              ألصق علامة الناقص مباشرة بالكلمة المستبعدة دون أي مسافة بينهما. المسافة قبل الناقص مطلوبة لفصله عن الكلمة
              السابقة، لكن أي مسافة بعد الناقص تُبطل عمله. الصيغة المدعومة رسميًا في معامل الاستعلام هي الناقص المتصل
              بالكلمة.
            </Ar>
            <p className="text-sm text-muted">
              Documented API form: <code dir="ltr">q = topic -excluded</code> (NOT semantics). Example sent to the API
              exactly as typed:
            </p>
            <Example text="تصوير سينمائي -مبتدئ" label="NOT syntax example" />
          </div>
        </Card>

        {/* ── C · OR ─────────────────────────────────────────────── */}
        <Card id="or" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SupportBadge kind="documented" />
          </div>
          <CardHeader title="C · Searching alternatives with OR" eyebrow="Operator: word1|word2" />
          <div className="space-y-3">
            <Example text="iPhone 15|iPhone 16" label="OR pipe example" />
            <Ar>
              الوثائق الرسمية تدعم عامل البدائل بصيغة الخط العمودي فقط. لا تستخدم الكلمة الإنجليزية OR كبديل مكافئ
              ومضمون داخل استعلامات الـ API. عند بناء روابط API خام يدويًا يُرمَّز الخط العمودي هكذا:
            </Ar>
            <Example text="%7C" label="URL-encoded pipe" />
            <p className="text-sm text-muted">
              Do not double-encode: this app&apos;s HTTP client already encodes parameters once — type the plain{" "}
              <code dir="ltr">|</code> in the Search bar and let the app handle encoding.
            </p>
          </div>
        </Card>

        {/* ── D · Plus ───────────────────────────────────────────── */}
        <Card id="plus" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SupportBadge kind="experimental" />
          </div>
          <CardHeader title="D · Including required words using plus signs" eyebrow="Tip (not an official operator): +word" />
          <div className="space-y-3">
            <Example text="صناعة المحتوى +الذكاء_الاصطناعي" label="plus tip example" />
            <Ar>
              صيغة الزائد المنتشرة كنصيحة شائعة فقط، وليست عامل كلمة-مطلوبة موثّقًا في معامل الاستعلام الرسمي. لا تعد
              بأنها تُجبر الـ API على تضمين الكلمة في النتائج.
            </Ar>
            <p className="text-sm text-muted">
              To genuinely require a concept, use the app&apos;s real controls: exact-phrase attempts (A), exclusion of
              noise (B), a tighter <code dir="ltr">order</code>, or the search-inside-results keyword over collected
              manifests (local, zero quota).
            </p>
          </div>
        </Card>

        {/* ── E · Content-type / quality ─────────────────────────── */}
        <Card id="content-type" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SupportBadge kind="experimental" />
          </div>
          <CardHeader title="E · Content-type and quality searches" eyebrow="Comma suffixes are not official filters" />
          <div className="space-y-3">
            <Ar>
              اللواحق المكتوبة بفاصلة ليست فلاتر رسمية في الـ API، حتى لو بدت مألوفة. استخدمها كتلميحات تجريبية فقط،
              وحقّق الهدف الحقيقي عبر فلتر منظم من خيارات البحث في التطبيق.
            </Ar>
            <div className="grid gap-2">
              <Example text="البرمجة للمبتدئين, playlist" label="playlist suffix example" />
              <Example text="ناشونال جيوغرافيك, channel" label="channel suffix example" />
              <Example text="أخبار, live" label="live suffix example" />
              <Example text="وثائقي, hd" label="hd suffix example" />
              <Example text="وثائقي, 4k" label="4k suffix example" />
              <Example text="طبخ, short" label="short suffix example" />
              <Example text="history, long" label="long suffix example" />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/60 text-xs uppercase text-muted">
                    <th className="px-3 py-2">What you typed</th>
                    <th className="px-3 py-2">What it really does</th>
                    <th className="px-3 py-2">Do this instead</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-[13px]" dir="ltr">, playlist / , channel</td>
                    <td className="px-3 py-2">Plain query words — no type filtering</td>
                    <td className="px-3 py-2">Resource type selector: Videos / Channels / Playlists</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-[13px]" dir="ltr">, live</td>
                    <td className="px-3 py-2">The word “live” — does not isolate broadcasts</td>
                    <td className="px-3 py-2">Event type filter: Live Now / Completed / Upcoming</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-[13px]" dir="ltr">, hd</td>
                    <td className="px-3 py-2">Plain query word — no quality filtering</td>
                    <td className="px-3 py-2">Definition filter: HD (does not guarantee 4K)</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-[13px]" dir="ltr">, 4k</td>
                    <td className="px-3 py-2">Plain query word — no 4K filter exists in the API</td>
                    <td className="px-3 py-2">Use the HD filter; verify resolution on the watch page</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-mono text-[13px]" dir="ltr">, short / , long</td>
                    <td className="px-3 py-2">Plain query words — not duration filters</td>
                    <td className="px-3 py-2">
                      Duration filter: Short (&lt; 4 min) / Medium / Long. Note: a duration-based “short” search is not
                      the same as the YouTube Shorts shelf — Shorts-like items are labeled as such, never guaranteed.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        {/* ── F · intitle ────────────────────────────────────────── */}
        <Card id="intitle" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SupportBadge kind="experimental" />
          </div>
          <CardHeader title="F · Searching for a word in the title" eyebrow="Syntax: intitle:word (unverified for the API)" />
          <div className="space-y-3">
            <Example text="intitle:مونتاج" label="intitle example" />
            <Ar>
              المقصود من هذه الصيغة هو تقييد البحث بالعناوين، لكنها غير موثّقة وغير مؤكدة لمعامل الاستعلام الرسمي. لا
              تعتبرها مطابقة للعناوين فقط عبر الـ API الخاص بهذا التطبيق.
            </Ar>
            <p className="text-sm text-muted">
              Real alternatives in this app: sort by <code dir="ltr">Title (A–Z)</code> to group title matches, or use
              search-inside-results over a collected manifest — its keyword box matches titles locally with zero quota.
            </p>
          </div>
        </Card>

        {/* ── G · Structured filters ─────────────────────────────── */}
        <Card id="structured" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SupportBadge kind="structured" />
          </div>
          <CardHeader title="G · Official advanced filters" eyebrow="Set in Search options — not typed as text" />
          <div className="space-y-3">
            <Ar>
              هذه الفلاتر الموثّقة تُضبط من خيارات البحث وتُرسل كمعاملات مستقلة، وليست كلمات داخل الاستعلام. الفرق
              الجوهري: عامل الاستعلام يلمّح لمحرك البحث، بينما المعامل المنظم يقيد النتائج فعليًا من جهة الـ API.
            </Ar>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
              <li>
                <strong className="text-foreground">Content type</strong> — Videos, Channels, or Playlists (resource type
                selector; maps to the API <code dir="ltr">type</code> parameter).
              </li>
              <li>
                <strong className="text-foreground">Video duration</strong> — Short (&lt; 4 min), Medium (4–20 min), or
                Long (&gt; 20 min) (<code dir="ltr">videoDuration</code>).
              </li>
              <li>
                <strong className="text-foreground">Definition</strong> — HD or Standard (<code dir="ltr">videoDefinition</code>;
                HD does not guarantee 4K).
              </li>
              <li>
                <strong className="text-foreground">Live broadcasts</strong> — Live Now, Completed, or Upcoming (
                <code dir="ltr">eventType</code>; video searches only).
              </li>
              <li>
                <strong className="text-foreground">Publication date &amp; sorting</strong> — Published After / Before
                plus Sort Order: Relevance, Upload Date, Rating, View Count, Title (A–Z), Video Count.
              </li>
              <li>
                <strong className="text-foreground">Captions &amp; embeddable</strong> — Has/Has-no captions; embeddable
                only.
              </li>
              <li>
                <strong className="text-foreground">Language &amp; region</strong> — Relevance Language (BCP-47) and
                Region code (ISO market list, e.g. US / EG / SA).
              </li>
              <li>
                <strong className="text-foreground">Sensitivity</strong> — SafeSearch: None (unrestricted), Moderate, or
                Strict; plus the app&apos;s Unrestricted Mode toggle.
              </li>
            </ul>
            <p className="text-sm text-muted">
              Video-only filters (duration, definition, captions, embeddable, event type) apply only when the resource
              type is Videos — the app clears them automatically for channel/playlist searches.
            </p>
          </div>
        </Card>

        {/* ── H · Templates ──────────────────────────────────────── */}
        <Card id="templates" className="scroll-mt-24">
          <CardHeader title="H · Ready-to-use query templates" eyebrow="Copy, adapt, search manually" />
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">Finding an old video by distinctive title words</p>
                <SupportBadge kind="experimental" />
              </div>
              <Example text={'"رحلة نيلية أسوان" 2019'} label="old video template" />
              <Ar>اجمع عبارة مميزة من العنوان مع سنة أو كلمة سياقية، ثم رتّب النتائج حسب تاريخ الرفع من الفلاتر.</Ar>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">Excluding an irrelevant topic</p>
                <SupportBadge kind="documented" />
              </div>
              <Example text="شرح إكسل للمحاسبة -ألعاب" label="exclusion template" />
              <Ar>استبعد الموضوع المزعج بالناقص المتصل مباشرة بالكلمة، وهي صيغة موثّقة في الـ API.</Ar>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">Searching for either of two topics</p>
                <SupportBadge kind="documented" />
              </div>
              <Example text="بودكاست تقني|بودكاست ثقافي" label="alternatives template" />
              <Ar>الخط العمودي هو عامل البدائل الموثّق. لا تكتب كلمة OR حرفيًا كبديل مضمون.</Ar>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">Looking for programming tutorials</p>
                <SupportBadge kind="structured" />
              </div>
              <Example text="python للمبتدئين مشروع عملي" label="tutorials template" />
              <Ar>
                اكتب كلمات تعليمية واضحة، ثم قيّد المدة من الفلاتر (طويل للدروس المعمّقة)، ورتّب حسب التقييم أو
                المشاهدات.
              </Ar>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">Finding channel or playlist results</p>
                <SupportBadge kind="structured" />
              </div>
              <Example text="ناشونال جيوغرافيك وثائقيات" label="channel playlist template" />
              <Ar>لا تعتمد على فاصلة ونوع المحتوى كنص. اختر نوع المورد (قنوات أو قوائم تشغيل) من خيارات البحث.</Ar>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">Narrowing by period or duration</p>
                <SupportBadge kind="structured" />
              </div>
              <Example text="ملخصات كتب صوتية" label="period duration template" />
              <Ar>
                حدّد الفترة من حقلي تاريخ النشر (بعد / قبل)، والمدة من فلتر المدة، والترتيب من خيارات الفرز — كلها
                فلاتر منظمة لا تُكتب داخل الاستعلام.
              </Ar>
            </div>
          </div>
        </Card>

        {/* ── I · References ─────────────────────────────────────── */}
        <Card id="references" className="scroll-mt-24">
          <CardHeader title="I · Reference links" eyebrow="Official documentation" />
          <ul className="space-y-3 text-sm">
            <li>
              <a
                href="https://developers.google.com/youtube/v3/docs/search/list"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open YouTube Data API search list documentation in a new tab"
                className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <span dir="ltr">YouTube Data API — Search: list</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
              <p className="mt-1 text-muted">
                The authoritative <code dir="ltr">q</code>, <code dir="ltr">type</code>,{" "}
                <code dir="ltr">videoDuration</code>, <code dir="ltr">eventType</code>, and ordering reference this
                app&apos;s provider calls follow.
              </p>
            </li>
            <li>
              <a
                href="https://support.google.com/youtube/answer/111997?hl=en"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open YouTube Help advanced search filters in a new tab"
                className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <span dir="ltr">YouTube Help — Advanced search filters</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
              <p className="mt-1 text-muted">
                End-user filter behavior on youtube.com — useful context, but website behavior may differ from what the
                Data API guarantees.
              </p>
            </li>
          </ul>
        </Card>
      </WorkspacePage>
    </AppShell>
  );
}
