import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Telegram Dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
