import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings";

export const metadata: Metadata = { title: "Cài đặt · Telegram Dashboard" };

export default function Page() {
  return <SettingsPage />;
}
