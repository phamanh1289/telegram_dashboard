import type { Metadata } from "next";
import { DocsApp } from "@/features/docs/components/app";

export const metadata: Metadata = { title: "Radar" };

export default function Page() {
  return <DocsApp />;
}
