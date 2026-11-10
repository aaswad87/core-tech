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
          <svg width="96" height="96" viewBox="0 0 64 64">
            <path d="M32 5 L55.4 18.5 L55.4 45.5 L32 59 L8.6 45.5 L8.6 18.5 Z" fill="#050807" stroke="#34D399" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M48.5 24.2 H34.8 A11 11 0 1 0 32.5 41.5" fill="none" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M42 24.2 V37" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
            <circle cx="42" cy="41.5" r="3.6" fill="#BEF264" />
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
