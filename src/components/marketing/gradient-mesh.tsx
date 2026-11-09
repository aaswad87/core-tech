import { cn } from "@/lib/utils";

/** Decorative animated violet/teal blobs. Place inside a `relative overflow-hidden` parent. */
export function GradientMesh({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const strength = tone === "dark" ? "opacity-70" : "opacity-60";
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className={cn("animate-mesh absolute -top-40 -right-32 size-[38rem] rounded-full bg-brand-400 blur-3xl", strength)} />
      <div
        className={cn("animate-mesh absolute -bottom-48 -left-40 size-[34rem] rounded-full bg-teal-glow blur-3xl", strength)}
        style={{ animationDelay: "-6s" }}
      />
      <div
        className={cn("animate-mesh absolute top-1/3 left-1/2 size-[22rem] rounded-full bg-fuchsia-300 blur-3xl", tone === "dark" ? "opacity-30" : "opacity-25")}
        style={{ animationDelay: "-12s" }}
      />
      {/* Fine grid texture for depth */}
      <div
        className={cn(
          "absolute inset-0 [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]",
          tone === "dark"
            ? "[background-image:linear-gradient(to_right,rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)]"
            : "[background-image:linear-gradient(to_right,rgb(17_24_39/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(17_24_39/0.05)_1px,transparent_1px)]",
        )}
      />
    </div>
  );
}
