import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { DEFAULT_FONT, FONTS } from "@/lib/fonts";
import "./globals.css";

// Title per page (app/page.tsx, youtrack): Settings sets its own localized one, which a layout title would overwrite.
export const metadata: Metadata = {};

// Runs before first paint. Theme: localStorage.theme = light | dark, else the OS preference. Row actions (Settings) so the
// first paint already shows or tucks them. Each member's look (Cài đặt chung, lib/prefs saveLook): uiStyle = simple |
// vivid, accent / accent2 = highlight hues 0-359, gradient = "1" (ignored in simple), font = a lib/fonts id (sets --font-body,
// loads only that face); tokens.css reads the result, and
// window.applyLook re-applies it after a change here or in another tab. Language (lib/i18n readLang): localStorage.lang,
// else the machine's; the HTML is prerendered in Vietnamese, so another language hides the page (data-i18n-wait,
// base.css) until Providers has re-rendered in it.
const FONT_MAP = JSON.stringify(Object.fromEntries(FONTS.map((f) => [f.id, [f.family, f.css, ...f.w]])));
const THEME_BOOT = `try{var t=localStorage.theme;if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.dataset.theme=t;if(localStorage.rowActions==="always")r.dataset.rowActions="always"}catch(e){}
(function(){var r=document.documentElement;function g(k){try{return localStorage[k]}catch(e){}}function h(v,d){var n=parseFloat(v);return n>=0&&n<360?n:d}
window.applyLook=function(){var l=g("uiStyle"),a=h(g("accent"),40),x=g("gradient")==="1"&&l!=="simple";if(l==="simple"||l==="vivid")r.dataset.look=l;else delete r.dataset.look;r.toggleAttribute("data-gradient",x);r.style.setProperty("--hl-h",a);r.style.setProperty("--hl-h2",x?h(g("accent2"),355):a);
var F=${FONT_MAP},k=g("font"),f=F[k]||F[k="${DEFAULT_FONT}"];r.style.setProperty("--font-body",(f[0]?f[0]+",":"")+'ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif');r.style.setProperty("--font-weight-normal",f[2]);r.style.setProperty("--font-weight-medium",f[3]);
if(f[1]&&!document.getElementById("font-"+k)){var n=document.createElement("link");n.id="font-"+k;n.rel="stylesheet";n.href="https://fonts.googleapis.com/css2?family="+f[1]+"&display=swap";document.head.appendChild(n)}};
window.applyLook();var L=g("lang");if(L!=="vi"&&L!=="en")L=/^vi\\b/i.test((navigator.languages&&navigator.languages[0])||navigator.language||"")?"vi":"en";r.lang=L;if(L!=="vi"){r.dataset.i18nWait="";setTimeout(function(){delete r.dataset.i18nWait},1500)}addEventListener("storage",function(e){if(["uiStyle","accent","accent2","gradient","font"].indexOf(e.key)>=0)window.applyLook()})})();`;

// Before any app code: a `?t=<token>` link (server / launcher / `myradar open`) is traded for the local API's
// cookie (auth.py), synchronously so the first API calls already carry it, then dropped from the address bar.
const AUTH_BOOT = `;(function(){try{var q=new URLSearchParams(location.search),t=q.get("t");if(!t)return;q.delete("t");var x=new XMLHttpRequest();x.open("POST","/api/auth",false);x.setRequestHeader("Content-Type","application/json");x.send(JSON.stringify({token:t}));var s=q.toString();history.replaceState(history.state,"",location.pathname+(s?"?"+s:"")+location.hash)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT + AUTH_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* the picked face's stylesheet is added by the boot script above (lib/fonts) */}
      </head>
      <body className="font-sans"><Providers>{children}</Providers></body>
    </html>
  );
}
