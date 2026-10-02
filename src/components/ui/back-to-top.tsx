"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BackToTop Button Component
 * ──────────────────────────────────────────────────────────────────────────
 * Appears when the user scrolls down the page (> 300px).
 * Provides a smooth scroll return to the top of the viewport.
 * Accessible, responsive, and styled to match the research SaaS design language.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function BackToTop({ threshold = 300 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setVisible(currentScrollY > threshold);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      title="Scroll back to top"
      className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border/80 bg-surface/90 text-foreground shadow-xl backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-primary/50 hover:bg-primary-soft hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 active:scale-95"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
