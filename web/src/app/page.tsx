import type { Metadata } from "next";
import { App } from "@/features/telegram/components/inbox";

export const metadata: Metadata = { title: "Radar" };

export default function Page() {
  return <App />;
}
