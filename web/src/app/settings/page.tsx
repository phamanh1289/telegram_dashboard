import type { Metadata } from "next";
import { SettingsPage } from "@/features/settings/components/settings";

// No title here: SettingsPage sets the localized "Settings · Radar" itself (lib/i18n).
export const metadata: Metadata = {};

export default function Page() {
  return <SettingsPage />;
}
