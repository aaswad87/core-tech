import { NextResponse } from "next/server";

import { buildAssetLinks } from "@/lib/pwa/asset-links";

/** Android Digital Asset Links for the Play Store (TWA) app. Empty until the Android app is configured. */
export function GET() {
  try {
    return NextResponse.json(buildAssetLinks(process.env), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    console.error("Invalid Android asset link configuration:", (error as Error).message);
    return NextResponse.json([], { status: 500 });
  }
}
