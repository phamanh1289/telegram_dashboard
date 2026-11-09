import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = { title: "Telegram Dashboard" };

// Runs before first paint. Theme: localStorage.theme = light | dark, else the OS preference. Row actions (Settings) so the
// first paint already shows or tucks them. Each member's look (Cài đặt chung, lib/prefs saveLook): uiStyle = simple |
// vivid, accent / accent2 = highlight hues 0-359, gradient = "1" (ignored in simple); tokens.css reads the result, and
// window.applyLook re-applies it after a change here or in another tab.
const THEME_BOOT = `try{var t=localStorage.theme;if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.dataset.theme=t;if(localStorage.rowActions==="always")r.dataset.rowActions="always"}catch(e){}
(function(){var r=document.documentElement;function g(k){try{return localStorage[k]}catch(e){}}function h(v,d){var n=parseFloat(v);return n>=0&&n<360?n:d}
window.applyLook=function(){var l=g("uiStyle"),a=h(g("accent"),40),x=g("gradient")==="1"&&l!=="simple";if(l==="simple"||l==="vivid")r.dataset.look=l;else delete r.dataset.look;r.toggleAttribute("data-gradient",x);r.style.setProperty("--hl-h",a);r.style.setProperty("--hl-h2",x?h(g("accent2"),355):a)};
window.applyLook();addEventListener("storage",function(e){if(["uiStyle","accent","accent2","gradient"].indexOf(e.key)>=0)window.applyLook()})})();`;

// Before any app code: a `?t=<token>` link (server / launcher / `mydashboard open`) is traded for the local API's
// cookie (auth.py), synchronously so the first API calls already carry it, then dropped from the address bar.
const AUTH_BOOT = `;(function(){try{var q=new URLSearchParams(location.search),t=q.get("t");if(!t)return;q.delete("t");var x=new XMLHttpRequest();x.open("POST","/api/auth",false);x.setRequestHeader("Content-Type","application/json");x.send(JSON.stringify({token:t}));var s=q.toString();history.replaceState(history.state,"",location.pathname+(s?"?"+s:"")+location.hash)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT + AUTH_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- static export, one shared font link for both modules */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" />
      </head>
      <body className="font-sans antialiased"><Providers>{children}</Providers></body>
    </html>
  );
}
