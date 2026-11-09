"use client";

import { useEffect, useState } from "react";

/**
 * Cycles through words with a fade. Screen readers get the full list once (no live announcements),
 * and the rotation stops for people who prefer reduced motion.
 */
export function RotatingWord({ words, intervalMs = 2400 }: { words: readonly string[]; intervalMs?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % words.length), intervalMs);
    return () => window.clearInterval(timer);
  }, [words.length, intervalMs]);

  return (
    <>
      <span className="sr-only">{words.join(", ")}</span>
      <span aria-hidden="true" className="relative inline-grid">
        {words.map((word, i) => (
          <span
            key={word}
            className={`col-start-1 row-start-1 transition-all duration-500 ${
              i === index ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            {word}
          </span>
        ))}
      </span>
    </>
  );
}
