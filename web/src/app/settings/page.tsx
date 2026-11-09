import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings";

export const metadata: Metadata = { title: "Cài đặt · Radar" };

export default function Page() {
  return <SettingsPage />;
}
