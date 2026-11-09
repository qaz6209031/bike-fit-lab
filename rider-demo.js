// Empty-stage demo: a side-view rider whose legs pedal, drawn in the same limb colors and
// angle tags the real overlay uses, so first-time visitors see what the app will draw on them.
// Runs only while the placeholder is visible and the tab is shown; reduced motion gets a still frame.

const NS = 'http://www.w3.org/2000/svg';
const HIP = { x: 94, y: 52 };
const BB = { x: 110, y: 112 };
const SHOULDER = { x: 140, y: 28 };
const ELBOW = { x: 158, y: 46 };
const HANDS = { x: 174, y: 56 };
const CRANK = 16;
const THIGH = 40;
const SHANK = 42;
const RPM = 80;

const el = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function legAt(theta) {
  const pedal = { x: BB.x + CRANK * Math.sin(theta), y: BB.y - CRANK * Math.cos(theta) };
  const dx = pedal.x - HIP.x;
  const dy = pedal.y - HIP.y;
  const d = Math.min(Math.hypot(dx, dy), THIGH + SHANK - 0.01);
  const a = Math.acos((THIGH * THIGH + d * d - SHANK * SHANK) / (2 * THIGH * d));
  const base = Math.atan2(dy, dx);
  // Two solutions; the knee always points forward (toward the bars).
  const k1 = { x: HIP.x + THIGH * Math.cos(base - a), y: HIP.y + THIGH * Math.sin(base - a) };
  const k2 = { x: HIP.x + THIGH * Math.cos(base + a), y: HIP.y + THIGH * Math.sin(base + a) };
  const knee = k1.x > k2.x ? k1 : k2;
  const cosK = (THIGH * THIGH + SHANK * SHANK - d * d) / (2 * THIGH * SHANK);
  return { pedal, knee, kneeDeg: Math.round((Math.acos(Math.max(-1, Math.min(1, cosK))) * 180) / Math.PI) };
}

export function mountRiderDemo(svg) {
  svg.setAttribute('viewBox', '0 0 240 150');
  svg.replaceChildren();
  const frame = el('g', { class: 'rd-bike' });
  frame.append(
    el('circle', { cx: 50, cy: 112, r: 33 }),
    el('circle', { cx: 190, cy: 112, r: 33 }),
    el('path', { d: `M50 112 L${BB.x} ${BB.y} L92 62 M${BB.x} ${BB.y} L166 64 L190 112 M92 62 L166 64 L170 52 M50 112 L92 62 M84 58 h18` }),
  );
  const torso = el('line', { class: 'rd-torso', x1: HIP.x, y1: HIP.y, x2: SHOULDER.x, y2: SHOULDER.y });
  const head = el('circle', { class: 'rd-head', cx: 147, cy: 18, r: 7.5 });
  const arm = el('polyline', { class: 'rd-arm', points: `${SHOULDER.x},${SHOULDER.y} ${ELBOW.x},${ELBOW.y} ${HANDS.x},${HANDS.y}` });
  const crank = el('line', { class: 'rd-crank', x1: BB.x, y1: BB.y });
  const leg = el('polyline', { class: 'rd-leg' });
  const joints = [HIP, SHOULDER, ELBOW].map((p) => el('circle', { class: 'rd-joint', cx: p.x, cy: p.y, r: 2.6 }));
  const kneeDot = el('circle', { class: 'rd-joint', r: 2.6 });
  const pedalDot = el('circle', { class: 'rd-pedal', r: 3 });
  const tagBg = el('rect', { class: 'rd-tag', width: 30, height: 14, rx: 7 });
  const tagText = el('text', { class: 'rd-tag-text', 'text-anchor': 'middle' });
  svg.append(frame, torso, head, arm, crank, leg, ...joints, kneeDot, pedalDot, tagBg, tagText);

  const render = (theta) => {
    const { pedal, knee, kneeDeg } = legAt(theta);
    crank.setAttribute('x2', pedal.x);
    crank.setAttribute('y2', pedal.y);
    leg.setAttribute('points', `${HIP.x},${HIP.y} ${knee.x},${knee.y} ${pedal.x},${pedal.y}`);
    kneeDot.setAttribute('cx', knee.x);
    kneeDot.setAttribute('cy', knee.y);
    pedalDot.setAttribute('cx', pedal.x);
    pedalDot.setAttribute('cy', pedal.y);
    // Below-right of the knee: clear of the arm at the top of the stroke and of the shin at the bottom.
    tagBg.setAttribute('x', knee.x + 7);
    tagBg.setAttribute('y', knee.y + 3);
    tagText.setAttribute('x', knee.x + 22);
    tagText.setAttribute('y', knee.y + 13.5);
    tagText.textContent = `${kneeDeg}°`;
  };

  let raf = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const visible = () => !svg.closest('[hidden]') && !document.hidden;
  const loop = (now) => {
    if (!visible() || reduced.matches) return stop();
    render(((now / 1000) * RPM * 2 * Math.PI) / 60);
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const start = () => {
    render(Math.PI / 2); // still frame: crank at 3 o'clock
    if (!raf && visible() && !reduced.matches) raf = requestAnimationFrame(loop);
  };
  document.addEventListener('visibilitychange', start);
  reduced.addEventListener?.('change', start);
  start();
  return { start, stop };
}
