import Image from "next/image";

import { type Photo, photoUrl } from "@/content/photos";
import { cn } from "@/lib/utils";

type PhotoFillProps = {
  photo: Photo;
  /** Responsive `sizes` hint so the optimizer serves an appropriately sized file. */
  sizes: string;
  priority?: boolean;
  className?: string;
};

/** A stock photo that fills its (relative, sized) parent. Alt text comes from src/content/photos.ts. */
export function PhotoFill({ photo, sizes, priority, className }: PhotoFillProps) {
  return (
    <Image
      src={photoUrl(photo)}
      alt={photo.alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn("object-cover", className)}
    />
  );
}
