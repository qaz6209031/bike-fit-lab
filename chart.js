// Knee & hip angle vs crank angle (one pedal revolution), as an inline SVG line chart.
// Drawn at the container's real pixel width (and redrawn on resize) so text stays 12px at every size.
// Colours validated for the dark surface with the dataviz palette validator.
import { t } from './i18n.js';

const SERIES = [
  { key: 'k', label: 'chart.knee', color: '#3b8fe8' },
  { key: 'h', label: 'chart.hip', color: '#d06a1c' },
];
const M = { l: 40, r: 12, t: 26, b: 30 };
const CLOCK = [[0, 12], [90, 3], [180, 6], [270, 9], [360, 12]];

/** Placeholder markup; mountCharts() draws the SVG once the element has a width. */
export function curveChart(curve) {
  const data = curve.map((b) => ({ d: b.deg, k: Math.round(b.knee), h: Math.round(b.hip) }));
  const legend = SERIES.map((s) => `<span><i style="background:${s.color}"></i>${t(s.label)}</span>`).join('');
  return `<div class="chart-wrap" data-curve='${JSON.stringify(data)}'>
    <div class="chart-legend">${legend}</div>
    <div class="chart-plot"></div>
    <div class="chart-tip" role="status" hidden></div>
    <p class="chart-caption">${t('chart.caption')}</p>
  </div>`;
}

function svgFor(data, W) {
  const H = Math.round(Math.min(280, Math.max(200, W * 0.42)));
  const vals = data.flatMap((p) => [p.k, p.h]).filter(Number.isFinite);
  const lo = Math.floor(Math.min(...vals, 140) / 10) * 10 - 10;
  const hi = Math.ceil(Math.max(...vals, 150) / 10) * 10;
  const x = (deg) => M.l + (deg / 360) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);

  const grid = [];
  for (let v = lo; v <= hi; v += 20) {
    grid.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`);
    grid.push(`<text x="${M.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}°</text>`);
  }
  // Narrow charts keep only 12 / 6 / 12; the ends anchor inward so they never spill past the card.
  const ticks = W < 380 ? CLOCK.filter(([d]) => d % 180 === 0) : CLOCK;
  const xt = ticks
    .map(([d, h]) => {
      const anchor = d === 0 ? 'start' : d === 360 ? 'end' : 'middle';
      const tx = d === 0 ? M.l : d === 360 ? W - M.r : x(d);
      return `<text x="${tx}" y="${H - 8}" text-anchor="${anchor}">${t('clockShort', { h })}</text>`;
    })
    .join('');
  const band = `<rect x="${M.l}" width="${W - M.l - M.r}" y="${y(150)}" height="${y(140) - y(150)}" class="band"/>
    <text x="${M.l + 6}" y="${y(150) - 6}" class="band-label">${t('chart.band')}</text>`;
  const lines = SERIES.map((s) => {
    const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
    // Direct label above each series' peak (the two lines meet at 12 o'clock, so the line ends collide).
    const peak = data.reduce((a, b) => (b[s.key] > a[s.key] ? b : a), data[0]);
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <text x="${x(peak.d)}" y="${y(peak[s.key]) - 8}" text-anchor="middle" class="direct">${t(s.label)} ${peak[s.key]}°</text>`;
  }).join('');

  return {
    x,
    html: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('chart.aria')}">
      ${band}${grid.join('')}${xt}${lines}
      <line class="cross" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" visibility="hidden"/>
      <rect class="hit" x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="transparent"/>
    </svg>`,
  };
}

function draw(wrap) {
  const plot = wrap.querySelector('.chart-plot');
  const W = Math.round(plot.clientWidth);
  if (!W || W === wrap._w) return;
  wrap._w = W;
  const data = JSON.parse(wrap.dataset.curve);
  const { html, x } = svgFor(data, W);
  plot.innerHTML = html;
  const svg = plot.querySelector('svg');
  const hit = svg.querySelector('.hit');
  const cross = svg.querySelector('.cross');
  const tip = wrap.querySelector('.chart-tip');
  hit.addEventListener('pointermove', (e) => {
    const deg = ((e.clientX - svg.getBoundingClientRect().left - M.l) / (W - M.l - M.r)) * 360;
    const b = data.reduce((best, p) => (Math.abs(p.d - deg) < Math.abs(best.d - deg) ? p : best), data[0]);
    cross.setAttribute('x1', x(b.d));
    cross.setAttribute('x2', x(b.d));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = t('chart.tip', { d: Math.round(b.d), k: b.k, h: b.h });
    // Keep the tooltip inside the chart at both ends of the axis.
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(x(b.d), half), W - half)}px`;
    tip.style.top = `${plot.offsetTop + M.t + 8}px`;
  });
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('pointercancel', hide);
}

const observer = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entries) => entries.forEach((e) => draw(e.target.closest('.chart-wrap'))))
  : null;

/** Draw every chart placeholder under root and keep it sized to its container. */
export function mountCharts(root) {
  for (const wrap of root.querySelectorAll('.chart-wrap')) {
    draw(wrap);
    observer?.observe(wrap.querySelector('.chart-plot'));
  }
}
