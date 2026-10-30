import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Telegram Dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.theme==="light")document.documentElement.classList.remove("dark")}catch{}` }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
