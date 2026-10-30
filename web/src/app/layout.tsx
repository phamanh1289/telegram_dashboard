import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Telegram Dashboard" };

// One key shared with the YouTrack module: localStorage.theme = light | dark, else the OS preference.
const THEME_BOOT = `try{var t=localStorage.theme;if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- static export, one shared font link for both modules */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
