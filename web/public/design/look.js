/* Each member's look (Cài đặt chung), saved per browser. Both modules load this before first paint; it re-applies when another tab changes it.
 * uiStyle = simple | vivid (missing = default), accent / accent2 = highlight hues 0–359, gradient = "1" (ignored in simple). tokens.css reads the result. */
{
  const r = document.documentElement;
  const get = (k) => { try { return localStorage[k]; } catch {} };
  const hue = (v, d) => { const n = parseFloat(v); return n >= 0 && n < 360 ? n : d; };
  window.applyLook = () => {
    const look = get('uiStyle'), h = hue(get('accent'), 40);
    const grad = get('gradient') === '1' && look !== 'simple';
    if (look === 'simple' || look === 'vivid') r.dataset.look = look; else delete r.dataset.look;
    r.toggleAttribute('data-gradient', grad);
    r.style.setProperty('--hl-h', h);
    r.style.setProperty('--hl-h2', grad ? hue(get('accent2'), 355) : h);
  };
  window.applyLook();
  addEventListener('storage', (e) => { if (['uiStyle', 'accent', 'accent2', 'gradient'].includes(e.key)) window.applyLook(); });
}
