// The share card: a 1080×1350 picture of a fit result (verdict, a few tape gauges, optionally the rider's
// annotated snapshot) drawn on a canvas in the browser. Nothing is uploaded; the rider shares or saves the file.

const W = 1080;
const H = 1350;
const P = 64;
const C = {
  alloy: '#e9ebee', sheet: '#ffffff', ink: '#1c2126', ink2: '#3a424b', muted: '#5b6570', rule: '#c9ced4',
  tape: '#ffc21a', tapeEdge: '#c99500', strip: '#fbfbfa', tick: '#a3aab2',
  good: '#17803d', close: '#b45309', bad: '#c2261d', na: '#5b6570',
};
const SANS = '"Archivo", ui-sans-serif, system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

/** Scale of a tape gauge: its ends, tick step and where the target band sits (all as 0–100 %). */
export function gaugeScale(m) {
  const [lo, hi] = m.range;
  const tol = m.tol || 5;
  const v = Number.isFinite(m.value) ? m.value : null;
  const bandLo = lo ?? hi - 4 * tol;
  const bandHi = hi ?? lo + 4 * tol;
  const pad = Math.max((bandHi - bandLo) * 0.5, tol * 1.5);
  let min = bandLo - pad;
  let max = bandHi + pad;
  if (lo == null && (v == null || v >= 0)) min = Math.min(0, bandLo); // "≤ x" scales start at zero
  if (v != null) {
    min = Math.min(min, v - tol * 0.6);
    max = Math.max(max, v + tol * 0.6);
  }
  const pct = (x) => ((x - min) / (max - min)) * 100;
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => (max - min) / s <= 30) ?? 20;
  const ticks = [];
  for (let x = Math.ceil(min / step) * step; x <= max; x += step) ticks.push({ p: pct(x), major: Math.round(x / step) % 5 === 0 });
  return {
    ticks,
    left: lo == null ? 0 : pct(bandLo),
    right: hi == null ? 100 : pct(bandHi),
    openLo: lo == null,
    openHi: hi == null,
    needle: v == null ? null : pct(v),
  };
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/**
 * Draws the card and returns its canvas.
 * @param {object} o
 * @param {string} o.title    verdict, e.g. "2 things to tweak."
 * @param {string} o.sub      e.g. "Start with: Saddle height."
 * @param {string} o.inRange  e.g. "3 of 8 measures in range"
 * @param {Array}  o.metrics  report metrics (label, value, unit, decimals, status, range, tol, target)
 * @param {string} o.targetWord  the word "Target" in the current language
 * @param {string} o.cta      footer line
 * @param {?string} o.shot    data URL of the annotated snapshot, or null to leave the photo out
 */
export async function drawShareCard({ title, sub, inRange, metrics, targetWord, cta, shot }) {
  await Promise.allSettled([document.fonts?.load(`800 64px Archivo`), document.fonts?.load(`400 28px Archivo`)]);
  const img = shot ? await loadImage(shot).catch(() => null) : null;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // Condensed Archivo for display and figures where the browser can do it; fitted to width either way.
  const font = (size, weight = 400, condensed = false) => {
    ctx.font = `${weight} ${size}px ${SANS}`;
    if ('fontStretch' in ctx) ctx.fontStretch = condensed ? 'condensed' : 'normal';
  };
  const fit = (text, maxW, size, weight, condensed) => {
    let s = size;
    font(s, weight, condensed);
    while (ctx.measureText(text).width > maxW && s > 18) font((s -= 2), weight, condensed);
    return s;
  };
  const text = (str, x, y, color, align = 'left') => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
  };

  ctx.fillStyle = C.alloy;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // Letterhead.
  font(46, 800, true);
  text('Free Bike Fit', P, 104, C.ink);
  font(26, 600);
  text('freebikefit.com', W - P, 102, C.muted, 'right');
  ctx.fillStyle = C.ink;
  ctx.fillRect(P, 124, W - 2 * P, 4);

  let y = 152;
  if (img) {
    // The annotated frame in a black well, shown whole.
    const wellH = 536;
    ctx.fillStyle = '#000';
    ctx.fillRect(P, y, W - 2 * P, wellH);
    const k = Math.min((W - 2 * P) / img.width, wellH / img.height);
    const dw = img.width * k;
    const dh = img.height * k;
    ctx.drawImage(img, P + (W - 2 * P - dw) / 2, y + (wellH - dh) / 2, dw, dh);
    y += wellH + 26;
  } else {
    y += 10;
  }

  // Verdict.
  const ts = fit(title, W - 2 * P, 104, 800, true);
  y += ts * 0.86;
  text(title, P, y, C.ink);
  font(32, 500);
  y += 50;
  fit(sub, W - 2 * P, 32, 500, false);
  text(sub, P, y, C.ink);
  if (inRange) {
    font(27, 400);
    y += 40;
    text(inRange, P, y, C.muted);
  }
  y += 30;

  // Gauges: as many rows as fit above the footer.
  const footH = 92;
  const rowH = 100;
  const rows = metrics.filter((m) => Number.isFinite(m.value)).slice(0, Math.max(0, Math.floor((H - footH - 18 - y) / rowH)));
  const gx = P + 560;
  const gw = W - P - gx;
  const gh = 40;
  for (const m of rows) {
    ctx.fillStyle = C.rule;
    ctx.fillRect(P, y, W - 2 * P, 2);
    const color = C[m.status] ?? C.ink;
    fit(m.label, 370, 28, 650, false);
    text(m.label, P, y + 44, C.ink);
    font(22, 400);
    fit(`${targetWord} ${m.target}`, 370, 22, 400, false);
    text(`${targetWord} ${m.target}`, P, y + 76, C.muted);

    const isDeg = m.unit === '°';
    const num = `${m.key === 'kops' && m.value > 0 ? '+' : ''}${m.value.toFixed(m.decimals)}${isDeg ? '°' : ''}`;
    font(58, 800, true);
    text(num, gx - 26, isDeg ? y + 70 : y + 56, color, 'right');
    if (!isDeg) {
      font(21, 600);
      text(String(m.unit).trim(), gx - 26, y + 82, C.muted, 'right');
    }

    // Tape strip: ticks from the top edge, target band in yellow, the value as the needle.
    const s = gaugeScale(m);
    const gy = y + (rowH - gh) / 2 + 1;
    const px = (p) => gx + (Math.max(0, Math.min(100, p)) / 100) * gw;
    ctx.fillStyle = C.strip;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = 'rgba(255, 194, 26, 0.6)';
    ctx.fillRect(px(s.left), gy, px(s.right) - px(s.left), gh);
    ctx.fillStyle = C.tapeEdge;
    if (!s.openLo) ctx.fillRect(px(s.left) - 1, gy, 2.5, gh);
    if (!s.openHi) ctx.fillRect(px(s.right) - 1.5, gy, 2.5, gh);
    for (const tk of s.ticks) {
      ctx.fillStyle = tk.major ? C.muted : C.tick;
      ctx.fillRect(Math.round(px(tk.p)), gy, 1.5, tk.major ? 17 : 9);
    }
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(gx, gy, gw, gh);
    if (s.needle != null) {
      ctx.fillStyle = color;
      ctx.fillRect(px(s.needle) - 3, gy - 5, 6, gh + 10);
    }
    y += rowH;
  }

  // Footer: where to get your own.
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, H - footH, W, footH);
  ctx.fillStyle = C.tape;
  ctx.fillRect(P, H - footH / 2 - 4, 26, 8);
  font(30, 600);
  fit(cta, W - 2 * P - 44 - 280, 30, 600, false);
  text(cta, P + 44, H - footH / 2 + 11, '#fff');
  font(32, 800, true);
  text('freebikefit.com', W - P, H - footH / 2 + 11, '#fff', 'right');

  return canvas;
}

export const canvasToBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
