import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const isHttpsSite = !isDev && (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  } catch {
    return "";
  }
})();

/**
 * Content Security Policy. Next.js inlines small bootstrap scripts, so script-src needs 'unsafe-inline'
 * (a nonce-based policy would make every page dynamic); everything else is locked to this site, the
 * Supabase project (auth/storage) and Unsplash images. Dev mode also needs 'unsafe-eval' and websockets.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://images.unsplash.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")}` : ""}${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // Only when the site is served over HTTPS; on plain-http local builds it would break every asset.
  ...(isHttpsSite ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: csp },
  // Enforces HTTPS once deployed on an https:// site URL.
  ...(isHttpsSite ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Marketing photography (Unsplash License). See src/content/photos.ts.
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-*" }],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    serverActions: {
      // Resume uploads go through a server action (max file 4 MB plus form overhead). Vercel rejects
      // request bodies over 4.5 MB, so larger files would need direct-to-storage uploads instead.
      bodySizeLimit: "4.5mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Service worker: never cached by the browser/CDN so updates roll out immediately,
        // and limited to same-origin scripts.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        // Android verifies the Play Store app ↔ domain link with this file.
        source: "/.well-known/assetlinks.json",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
