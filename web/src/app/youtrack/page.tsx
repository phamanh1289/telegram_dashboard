import type { Metadata } from "next";
import { YouTrackApp } from "@/components/yt/app";

export const metadata: Metadata = { title: "Radar" };

export default function Page() {
  return <YouTrackApp />;
}
