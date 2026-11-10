import { ImageResponse } from "next/og";

import { siteConfig } from "@/config/site";

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "linear-gradient(135deg, #050807 0%, #064e3b 55%, #4d7c0f 100%)",
          color: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="88" height="88" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill="#059669" />
            <path d="M21.5 10.5a8 8 0 1 0 0 11" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
            <circle cx="16" cy="16" r="2.75" fill="#BEF264" />
          </svg>
          <div style={{ display: "flex", fontSize: 48, fontWeight: 700 }}>
            CoreTech&nbsp;<span style={{ color: "#A7F3D0", fontWeight: 400 }}>Recruiting</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>{siteConfig.tagline}</div>
          <div style={{ fontSize: 30, color: "#D9F99D" }}>
            IT · Networking · Cybersecurity · Cloud · Telecommunications
          </div>
        </div>
      </div>
    ),
    size,
  );
}
