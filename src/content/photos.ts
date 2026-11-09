import type { SpecialtySlug } from "@/content/specialties";

/**
 * Marketing photography. All images are stock photos from Unsplash, free for commercial use under the
 * Unsplash License (https://unsplash.com/license); each `source` is the photo's page, checked on
 * 2026-10-30 as "Free to use" (not Unsplash+).
 *
 * These are illustrative stock images. Never caption them as CoreTech employees, clients, candidates or
 * placements, and never pair them with names, quotes or testimonials. Replace with real team photos
 * when available.
 */
export type Photo = {
  id: string;
  alt: string;
  source: string;
};

export const photos = {
  handshakeWomen: {
    id: "photo-1758520144427-ddb02ac74e9d",
    alt: "Two professionals shaking hands across a desk after a meeting",
    source: "https://unsplash.com/photos/two-women-shaking-hands-across-a-desk-9TF9pMrCFMo",
  },
  handshakeTable: {
    id: "photo-1758518730384-be3d205838e8",
    alt: "Two professionals shaking hands across a table",
    source: "https://unsplash.com/photos/two-professionals-shaking-hands-across-a-table-jEpZNyFSQwQ",
  },
  interview: {
    id: "photo-1758520144437-f068ecaf0d83",
    alt: "An interviewer in glasses speaking with a candidate at an office desk",
    source: "https://unsplash.com/photos/woman-in-glasses-interviews-man-at-office-desk-pg2eJwNVpvY",
  },
  professionals: {
    id: "photo-1758520144426-edf40a58f299",
    alt: "Four professionals in business attire talking in an office",
    source: "https://unsplash.com/photos/four-professionals-in-suits-discussing-in-an-office-0L1XzREL6Mo",
  },
  serverTechnician: {
    id: "photo-1785682117028-6fcf2c0b515b",
    alt: "A technician in a safety vest working on server and network equipment",
    source: "https://unsplash.com/photos/technician-working-on-server-equipment-with-tools-ufT32_VFS-I",
  },
  engineerMonitors: {
    id: "photo-1763128516808-785e80c1dd68",
    alt: "An engineer working at a desk with several monitors showing code and terminals",
    source: "https://unsplash.com/photos/man-typing-on-keyboard-in-front-of-multiple-computer-monitors-Nm_hDwuVtcw",
  },
  engineerDesk: {
    id: "photo-1580894908361-967195033215",
    alt: "An engineer working at a computer in a bright office",
    source: "https://unsplash.com/photos/woman-in-green-shirt-sitting-in-front-of-computer-64YrPKiguAE",
  },
  presenter: {
    id: "photo-1580894732444-8ecded7900cd",
    alt: "A smiling professional presenting at a whiteboard",
    source: "https://unsplash.com/photos/smiling-woman-presenting-at-whiteboard-TXxiFuQLBKQ",
  },
  teamLaptop: {
    id: "photo-1572021335469-31706a17aaef",
    alt: "Four coworkers smiling around a laptop at a shared table",
    source: "https://unsplash.com/photos/four-coworkers-smiling-around-laptop-at-table-Of_m3hMsoAA",
  },
  boardMeeting: {
    id: "photo-1622675363311-3e1904dc1885",
    alt: "A team with laptops listening during a meeting",
    source:
      "https://unsplash.com/photos/four-people-all-on-laptops-two-men-and-two-women-listen-to-person-talking-in-a-board-meeting-ZT5v0puBjZI",
  },
  fiberOptic: {
    id: "photo-1792419764935-2e48217354d1",
    alt: "Close-up of a fiber optic cable with LC duplex connectors",
    source: "https://unsplash.com/photos/fiber-optic-cable-with-blue-connectors-FK0P6Z2DIVk",
  },
} satisfies Record<string, Photo>;

export type PhotoKey = keyof typeof photos;

/** Unsplash CDN URL; next/image resizes and converts it (see images.remotePatterns in next.config.ts). */
export function photoUrl(photo: Photo, opts: { w?: number; h?: number } = {}): string {
  const params = new URLSearchParams({ auto: "format", fit: "crop", q: "80", w: String(opts.w ?? 1600) });
  if (opts.h) params.set("h", String(opts.h));
  return `https://images.unsplash.com/${photo.id}?${params.toString()}`;
}

export const specialtyPhotos: Record<SpecialtySlug, Photo> = {
  "it-recruiting": photos.engineerDesk,
  networking: photos.serverTechnician,
  cybersecurity: photos.engineerMonitors,
  cloud: photos.teamLaptop,
  telecommunications: photos.fiberOptic,
};
