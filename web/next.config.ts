import type { NextConfig } from "next";

// Build: static export served by FastAPI on :8765. Dev: proxy /api to FastAPI.
// Export mode must not declare rewrites/headers, so the two modes are separate.
const isBuild = process.env.NODE_ENV === "production";

const config: NextConfig = isBuild
  ? { output: "export", images: { unoptimized: true }, trailingSlash: true } // /youtrack/ -> out/youtrack/index.html
  : {
      // API_ORIGIN: a second dev server against another backend (a fixture) while the live app keeps :8765;
      // its own distDir, since `next dev` locks `.next/dev` per folder.
      ...(process.env.API_ORIGIN && { distDir: ".next/fixture" }),
      async rewrites() {
        const api = process.env.API_ORIGIN ?? "http://127.0.0.1:8765";
        return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
      },
    };

export default config;
