/**
 * Recognizable Dailymotion brand mark as a local inline SVG — no external
 * image dependency, no generic video icon. The wordmark-adjacent "d" swirl
 * follows the public Dailymotion logo geometry in a simplified form.
 */
export function DailymotionIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.9 13.7a3.9 3.9 0 0 1-6.6 2.8l-2.5-3.4a.6.6 0 0 1 .1-.8l.4-.3a.6.6 0 0 1 .8.1l1.9 2.6a2.6 2.6 0 0 0 4.4-1.9l1.8-2.6a2.6 2.6 0 0 0-4.4-1.9l-1.4 2a.6.6 0 0 1-.8.1l-.4-.3a.6.6 0 0 1-.1-.8l1.9-2.7a3.9 3.9 0 0 1 6.6 2.8l-1.7 4.4Z" />
    </svg>
  );
}
