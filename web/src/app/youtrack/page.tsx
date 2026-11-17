import type { Metadata } from "next";
import { YouTrackApp } from "@/features/youtrack/components/app";

export const metadata: Metadata = { title: "Radar" };

export default function Page() {
  return <YouTrackApp />;
}
