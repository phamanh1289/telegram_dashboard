"use client";

import { Check, Monitor, Moon, Pipette, RotateCcw, Sun } from "lucide-react";
import { useState } from "react";
import { LookPreview } from "@/features/settings/components/look-preview";
import { MascotRow } from "@/features/settings/components/mascot";
import { Card, picked, quietBtn, Row, Switch } from "@/features/settings/components/parts";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Hint } from "@/shared/components/ui/hint";
import { Segmented } from "@/shared/components/ui/segmented";
import { FONT_SIZES, FONTS, type FontId } from "@/shared/lib/fonts";
import { type Key, tMaybe, useT } from "@/shared/lib/i18n";
import { ACCENTS, applyTheme, CHROMA_MAX, CHROMA_MIN, hexToAccent, type Look, MIXES, oklchHex, readLook, readTheme, saveLook, type ThemePref, type UiStyle } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

const THEMES = [["light", "Sáng", Sun], ["dark", "Tối", Moon], ["system", "Theo hệ thống", Monitor]] as const;

const STYLES: { value: UiStyle; label: Key; hint: Key; pro?: boolean }[] = [
  { value: "simple", label: "Đơn giản", hint: "Phẳng, màu dịu, không gradient, chuyển động nhanh gọn." },
  { value: "default", label: "Mặc định", hint: "Cân bằng: nền ấm nhẹ, bóng mềm, màu nhấn rõ." },
  { value: "vivid", label: "Rực rỡ", pro: true,
    hint: "Màu đậm hơn, nền loang theo màu của bạn, nút phát sáng, chuyển động nảy; bật gradient thì màu chạy chậm." },
];
const WHEEL = `linear-gradient(to right in oklch, ${Array.from({ length: 37 }, (_, i) => `oklch(66% 0.17 ${i * 10})`).join()})`;
const swatch = (h: number, k = 1) => `oklch(58% ${0.13 * k} ${h})`;

/** Each member's look, saved in this browser and applied in every open tab (the boot script in app/layout.tsx). */
export function LookSection() {
  const t = useT();
  const [look, setLook] = useState<Look>(readLook);
  const set = (patch: Partial<Look>) => { const next = { ...look, ...patch }; setLook(next); saveLook(next); };
  const simple = look.style === "simple";
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  // Cards on the left, the live preview pinned on the right (below them when the page is narrow).
  return (
  <div className="@container">
  <div className="grid gap-4 @min-[52rem]:grid-cols-[minmax(0,1fr)_19rem] @min-[52rem]:items-start">
  <div className="grid min-w-0 content-start gap-4">
  <Card title="Chủ đề và chữ">
    <Row label={t("Chế độ màu")} stack>
      <Segmented id="set-theme" variant="card" label={t("Giao diện")} value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }}
        items={THEMES.map(([v, name, ThemeIcon]) => ({ value: v, label: <><ThemeIcon className="size-3.5" aria-hidden />{t(name)}</> }))} />
    </Row>
    <Row label={t("Phong cách")} desc={t(STYLES.find((o) => o.value === look.style)!.hint)} stack>
      <Segmented id="set-style" variant="card" label={t("Phong cách")} value={look.style} onChange={(style) => set({ style })}
        items={STYLES.map((o) => ({ value: o.value, label: o.pro ? <>{t(o.label)} <span className="rounded-sm bg-hl-wash px-1 text-2xs font-bold text-hl-2">Pro</span></> : t(o.label) }))} />
    </Row>
    <Row label={t("Font chữ")} desc={t("Áp dụng cho cả Telegram và YouTrack trên trình duyệt này.")}>
      <Dropdown label={t("Font chữ")} className="w-48" value={look.font} onChange={(v) => set({ font: v as FontId })}
        options={FONTS.map((f) => ({ value: f.id, label: tMaybe(f.label), hint: tMaybe(f.hint) }))} />
    </Row>
    <Row label={t("Cỡ chữ")} desc={t("Phóng to / thu nhỏ chữ toàn app; khoảng cách giữ nguyên.")}>
      <Segmented id="set-font-size" variant="card" label={t("Cỡ chữ")} value={look.size} onChange={(size) => set({ size })}
        items={FONT_SIZES.map((z) => ({ value: z.id, label: t(z.label) }))} />
    </Row>
  </Card>
  <Card title="Màu sắc">
          <Row label={t("Màu chủ đạo")} desc={look.hue >= 60 && look.hue <= 100 ? <span className="text-warn">{t("Gần màu hổ phách dùng cho tin “cần bạn” (quá hạn), dễ lẫn.")}</span> : undefined} stack>
            <div className="grid gap-2.5">
              <div role="radiogroup" aria-label={t("Màu có sẵn")} className="flex flex-wrap gap-1.5">
                {ACCENTS.map(([h, name]) => (
                  <Hint key={h} side="bottom" text={t(name)}><button type="button" role="radio" aria-checked={look.hue === h} aria-label={t(name)} onClick={() => set({ hue: h })}
                    className={cn("grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-cotton transition-shadow duration-(--dur-micro)",
                      look.hue === h ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-rule-2")}
                    style={{ background: swatch(h, look.chroma) }}>
                    {look.hue === h && <Check className="size-3.5 text-white" aria-hidden />}
                  </button></Hint>
                ))}
                <Hint side="bottom" text={t("Chọn màu bất kỳ (bảng màu, mã hex)")}>
                  <label className="relative grid size-7 cursor-pointer place-items-center rounded-full ring-offset-2 ring-offset-cotton hover:ring-2 hover:ring-rule-2 has-focus-visible:ring-2 has-focus-visible:ring-focus"
                    style={{ background: `conic-gradient(in oklch longer hue, ${swatch(0)}, ${swatch(0)})` }}>
                    <Pipette className="size-3.5 text-white drop-shadow-sm" aria-hidden />
                    <input type="color" aria-label={t("Chọn màu bất kỳ (bảng màu, mã hex)")} value={oklchHex(0.53, 0.135 * look.chroma, look.hue)}
                      onChange={(e) => set(hexToAccent(e.target.value))} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                  </label>
                </Hint>
              </div>
              <HueSlider label={t("Kéo để chọn màu chủ đạo")} value={look.hue} onChange={(hue) => set({ hue })} chroma={look.chroma} />
            </div>
          </Row>
          <Row label={t("Độ đậm")} desc={t("Kéo trái cho màu dịu, kéo phải cho màu rực.")} stack>
            <Slider label={t("Độ đậm")} min={CHROMA_MIN} max={CHROMA_MAX} step={0.05} value={look.chroma} onChange={(chroma) => set({ chroma })}
              track={`linear-gradient(to right in oklch, ${swatch(look.hue, 0)}, ${swatch(look.hue, CHROMA_MAX)})`} thumb={swatch(look.hue, look.chroma)} />
          </Row>
          <Row label="Gradient" desc={simple ? t("Phong cách Đơn giản không dùng gradient.") : t("Nút, tab đang mở, chip chọn phối từ màu chủ đạo sang màu thứ hai.")}>
            <Switch label="Gradient" checked={look.gradient && !simple} disabled={simple} onChange={(gradient) => set({ gradient })} />
          </Row>
          {look.gradient && !simple && (
            <div className="grid gap-2 py-3">
              <HueSlider label={t("Kéo để chọn màu thứ hai của gradient")} value={look.hue2} onChange={(hue2) => set({ hue2 })} chroma={look.chroma} />
              <div aria-hidden className="h-7 rounded-md" style={{ background: `linear-gradient(120deg, ${swatch(look.hue, look.chroma)}, ${swatch(look.hue2, look.chroma)})` }} />
            </div>
          )}
          <Row label={t("Pha sẵn")} desc={t("Một chạm: bật Gradient với cặp màu này.")} stack>
            <div role="radiogroup" aria-label={t("Pha sẵn")} className="flex flex-wrap gap-1.5">
              {MIXES.map(([a, b, name]) => {
                const on = look.gradient && !simple && look.hue === a && look.hue2 === b;
                return (
                  <button key={name} type="button" role="radio" aria-checked={on} disabled={simple} onClick={() => set({ hue: a, hue2: b, gradient: true })}
                    className={cn("flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-xs disabled:cursor-not-allowed disabled:opacity-40", picked(on), on && "text-hl-2")}>
                    <span aria-hidden className="size-6 rounded-full" style={{ background: `linear-gradient(120deg, ${swatch(a, look.chroma)}, ${swatch(b, look.chroma)})` }} />
                    {t(name)}
                  </button>
                );
              })}
            </div>
          </Row>
          {(look.hue !== 40 || look.chroma !== 1 || look.gradient) && (
            <span className="pt-3"><button type="button" className={cn(quietBtn, "inline-flex items-center gap-1")} onClick={() => set({ hue: 40, hue2: 355, chroma: 1, gradient: false })}>
              <RotateCcw className="size-3.5" aria-hidden />{t("Về màu mặc định")}
            </button></span>
          )}
  </Card>
  <Card title="Linh vật AI"><MascotRow /></Card>
  </div>
  <LookPreview className="@min-[52rem]:sticky @min-[52rem]:top-20" />
  </div>
  </div>
  );
}

const HueSlider = ({ label, value, onChange, chroma }: { label: string; value: number; onChange: (v: number) => void; chroma: number }) => (
  <Slider label={label} min={0} max={359} step={1} value={value} onChange={onChange} track={WHEEL} thumb={swatch(value, chroma)} />
);

function Slider({ label, min, max, step, value, onChange, track, thumb }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; track: string; thumb: string }) {
  return (
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}
      className="hue-range" style={{ "--track": track, "--thumb": thumb } as React.CSSProperties} />
  );
}
