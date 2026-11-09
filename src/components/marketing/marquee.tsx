import { cn } from "@/lib/utils";

/**
 * Infinite horizontal ticker. The list is rendered twice for a seamless loop; the copy is hidden
 * from assistive tech. Pauses on hover; static under reduced motion.
 */
export function Marquee({ items, label, className }: { items: readonly string[]; label: string; className?: string }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} aria-label={hidden ? undefined : label} className="flex shrink-0 items-center gap-3 pr-3">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full border border-brand/15 bg-white/80 px-4 py-2 text-sm font-medium whitespace-nowrap text-ink shadow-sm backdrop-blur"
        >
          {item}
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className={cn(
        "group relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
        className,
      )}
    >
      <div className="animate-marquee flex group-hover:[animation-play-state:paused]">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
