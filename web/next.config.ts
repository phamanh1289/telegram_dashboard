import type { NextConfig } from "next";

// Build: static export served by FastAPI on :8765. Dev: proxy /api to FastAPI.
// Export mode must not declare rewrites/headers, so the two modes are separate.
const isBuild = process.env.NODE_ENV === "production";

const config: NextConfig = isBuild
  ? { output: "export", images: { unoptimized: true }, trailingSlash: true } // /youtrack/ -> out/youtrack/index.html
  : {
      async rewrites() {
        return [{ source: "/api/:path*", destination: "http://127.0.0.1:8765/api/:path*" }];
      },
    };

export default config;
