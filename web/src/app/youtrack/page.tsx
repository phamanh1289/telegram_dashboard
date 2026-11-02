import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { YouTrackApp } from "@/components/yt/app";

export const metadata: Metadata = { title: "YouTrack Dashboard" };

export default function Page() {
  return (
    <Providers>
      <YouTrackApp />
    </Providers>
  );
}
