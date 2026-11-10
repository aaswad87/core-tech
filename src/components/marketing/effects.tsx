"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** True when fine-pointer hover effects are appropriate (mouse/trackpad, motion allowed). */
function hoverEffectsAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Decorative emerald glow that follows the pointer across its parent section. Place inside a
 * `relative overflow-hidden` parent; it listens on that parent and paints behind the content.
 */
export function Spotlight({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || !hoverEffectsAllowed()) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = host.getBoundingClientRect();
        el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
        el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
      });
    };
    host.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <div ref={ref} aria-hidden="true" className={cn("spotlight pointer-events-none absolute inset-0", className)} />;
}

/**
 * Gives its child a gentle 3D tilt toward the pointer. Purely visual: the child keeps its own
 * semantics and focus behavior. Off on touch devices and with reduced motion.
 */
export function Tilt({ children, className, max = 6 }: { children: React.ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hoverEffectsAllowed()) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(1000px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateZ(0)`;
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      el.style.transform = "";
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => {
      reset();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", reset);
    };
  }, [max]);

  return (
    <div ref={ref} className={cn("transition-transform duration-300 ease-out will-change-transform", className)}>
      {children}
    </div>
  );
}
