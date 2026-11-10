import { cn } from "@/lib/utils";

/** Decorative animated emerald/lime glows. Place inside a `relative overflow-hidden` parent. */
export function GradientMesh({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className={cn("animate-mesh absolute -top-40 -right-32 size-[38rem] rounded-full blur-3xl", dark ? "bg-brand-500 opacity-30" : "bg-brand-400 opacity-35")} />
      <div
        className={cn("animate-mesh absolute -bottom-48 -left-40 size-[34rem] rounded-full blur-3xl", dark ? "bg-teal opacity-20" : "bg-teal-glow opacity-40")}
        style={{ animationDelay: "-6s" }}
      />
      <div
        className={cn("animate-mesh absolute top-1/3 left-1/2 size-[22rem] rounded-full bg-cyan-400 blur-3xl", dark ? "opacity-15" : "opacity-15")}
        style={{ animationDelay: "-12s" }}
      />
      {/* Fine grid texture for depth */}
      <div
        className={cn(
          "absolute inset-0 [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]",
          dark
            ? "[background-image:linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)]"
            : "[background-image:linear-gradient(to_right,rgb(10_15_13/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(10_15_13/0.05)_1px,transparent_1px)]",
        )}
      />
    </div>
  );
}
