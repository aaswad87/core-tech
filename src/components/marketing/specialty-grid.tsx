import { ArrowUpRightIcon, CloudIcon, NetworkIcon, RadioTowerIcon, ServerIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";

import { PhotoFill } from "@/components/marketing/photo";
import { specialtyPhotos } from "@/content/photos";
import { type SpecialtySlug, specialties } from "@/content/specialties";
import { cn } from "@/lib/utils";

export const SPECIALTY_ICONS: Record<SpecialtySlug, typeof NetworkIcon> = {
  "it-recruiting": ServerIcon,
  networking: NetworkIcon,
  cybersecurity: ShieldCheckIcon,
  cloud: CloudIcon,
  telecommunications: RadioTowerIcon,
};

/** Photo cards for each specialty. The first card spans two columns on large screens for rhythm. */
export function SpecialtyGrid({ exclude }: { exclude?: SpecialtySlug }) {
  const items = specialties.filter((s) => s.slug !== exclude);

  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((s, index) => {
        const Icon = SPECIALTY_ICONS[s.slug];
        const featured = !exclude && index === 0;
        return (
          <li key={s.slug} className={cn("reveal", featured && "lg:col-span-2")}>
            <Link
              href={`/services/${s.slug}`}
              className="group relative isolate flex h-full min-h-72 flex-col justify-end overflow-hidden rounded-3xl p-6 text-white shadow-lg shadow-brand/10 ring-1 ring-black/5 focus-visible:ring-4 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              <PhotoFill
                photo={specialtyPhotos[s.slug]}
                sizes={featured ? "(min-width: 1024px) 66vw, (min-width: 640px) 50vw, 100vw" : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"}
                className="-z-20 transition-transform duration-700 ease-out group-hover:scale-110"
              />
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-night via-night/70 to-brand/10 transition-opacity duration-500 group-hover:opacity-90" />
              <span className="mb-auto inline-flex size-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-6 flex items-center gap-2 text-xl font-semibold">
                {s.name}
                <ArrowUpRightIcon
                  className="size-5 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
                  aria-hidden="true"
                />
              </h3>
              <p className="mt-2 max-w-md text-sm text-white/85">{s.summary}</p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
