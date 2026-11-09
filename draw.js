// Canvas overlay: skeleton, angle arcs, reference lines and pedal trail.
import { t } from './i18n.js';

export const COLORS = {
  good: '#34d399',
  close: '#fbbf24',
  bad: '#f87171',
  na: '#e5e7eb',
  leg: '#60a5fa',
  arm: '#c084fc',
  torso: '#fb923c',
  foot: '#5eead4',
  ref: 'rgba(255,255,255,0.7)',
};

/**
 * Canvas units per CSS pixel, so labels and strokes keep a readable on-screen size
 * whatever the video resolution or display width (15px labels on desktop, ~12px on phones).
 */
export function uiScale(canvas) {
  // object-fit: contain letterboxes one axis; the axis that fills the element sets the scale.
  const perCssPx = Math.max(canvas.width / (canvas.clientWidth || canvas.width), canvas.height / (canvas.clientHeight || canvas.height));
  const shown = canvas.width / perCssPx;
  return Math.max(0.5, perCssPx * (shown < 600 ? 0.8 : 1));
}

function line(ctx, a, b, color, width, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function dot(ctx, p, r, color) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0f17';
  ctx.fill();
  ctx.lineWidth = r * 0.6;
  ctx.strokeStyle = color;
  ctx.stroke();
}

const tagFont = (s) => `600 ${Math.round(15 * s)}px ui-sans-serif, system-ui, "PingFang TC", "Noto Sans TC", sans-serif`;

export function tagSize(ctx, text, s) {
  ctx.save();
  ctx.font = tagFont(s);
  const w = ctx.measureText(text).width + 12 * s;
  ctx.restore();
  return { w, h: 22 * s };
}

export function tag(ctx, x, y, text, color, s) {
  const { w, h } = tagSize(ctx, text, s);
  ctx.save();
  ctx.font = tagFont(s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(11,15,23,0.82)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 6 * s);
  else ctx.rect(x - w / 2, y - h / 2, w, h); // Safari < 16, Firefox < 112
  ctx.fill();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function angleArc(ctx, a, b, c, r, color, text, s, flipLabel = false) {
  const a1 = Math.atan2(a.y - b.y, a.x - b.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.arc(b.x, b.y, r, a1, a1 + d, d < 0);
  ctx.closePath();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, a1, a1 + d, d < 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * s;
  ctx.stroke();
  ctx.restore();
  // The label is placed later, after every arc, so placeLabels can keep labels from covering each other.
  return text ? { text, color, at: b, dir: a1 + d / 2 + (flipLabel ? Math.PI : 0), r: r + 24 * s } : null;
}

/** Put each label on its arc's bisector, stepping outward until it clears the labels already placed. */
function placeLabels(ctx, labels, s) {
  const placed = [];
  const hits = (b) => placed.some((q) => Math.abs(q.x - b.x) * 2 < q.w + b.w + 4 * s && Math.abs(q.y - b.y) * 2 < q.h + b.h + 4 * s);
  for (const l of labels.filter(Boolean)) {
    const { w, h } = tagSize(ctx, l.text, s);
    let box;
    for (let k = 0; k < 8; k++) {
      const rr = l.r + k * 10 * s;
      box = { x: l.at.x + Math.cos(l.dir) * rr, y: l.at.y + Math.sin(l.dir) * rr, w, h };
      if (!hits(box)) break;
    }
    placed.push(box);
    tag(ctx, box.x, box.y, l.text, l.color, s);
  }
}

/**
 * @param p   smoothed points (shoulder, elbow, wrist, hip, knee, ankle, heel, toe, ball)
 * @param m   metrics for p
 * @param o   { status: {torso, elbow, shoulder}, trail: [{x,y}], kneeMax, atThree, roll, bb, crankR }
 */
export function drawOverlay(ctx, p, m, o) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const s = uiScale(ctx.canvas);
  const st = (k) => COLORS[o.status?.[k] ?? 'na'];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Pedal path (ball of foot trail).
  if (o.trail?.length > 2) {
    ctx.beginPath();
    o.trail.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.strokeStyle = 'rgba(94,234,212,0.35)';
    ctx.lineWidth = 3 * s;
    ctx.stroke();
  }

  // True horizontal / vertical (corrected for camera roll from the wheel calibration).
  const roll = o.roll ?? 0;
  const hx = Math.cos(roll), hy = Math.sin(roll);

  // Crank: estimated or clicked bottom bracket, pedal circle and crank arm.
  if (o.bb && o.crankR) {
    ctx.save();
    ctx.setLineDash([5 * s, 7 * s]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.arc(o.bb.x, o.bb.y, o.crankR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const a = Math.atan2(p.ball.y - o.bb.y, p.ball.x - o.bb.x);
    const pedal = { x: o.bb.x + Math.cos(a) * o.crankR, y: o.bb.y + Math.sin(a) * o.crankR };
    line(ctx, o.bb, pedal, '#cbd5e1', 4 * s);
    dot(ctx, o.bb, 7 * s, '#cbd5e1');
    dot(ctx, pedal, 5 * s, '#facc15');
  }

  // Horizontal reference for torso angle.
  const torsoLen = Math.hypot(p.shoulder.x - p.hip.x, p.shoulder.y - p.hip.y);
  const horiz = { x: p.hip.x + m.dir * torsoLen * 1.1 * hx, y: p.hip.y + m.dir * torsoLen * 1.1 * hy };
  line(ctx, p.hip, horiz, COLORS.ref, 2 * s, [8 * s, 6 * s]);

  // Knee plumb line (knee-over-pedal check). Highlighted when the crank is at 3 o'clock.
  const atThree = !!o.atThree;
  const plumbLen = Math.max(p.ball.y, p.toe.y, p.heel.y) - p.knee.y + 30 * s;
  const plumbEnd = { x: p.knee.x - hy * plumbLen, y: p.knee.y + hx * plumbLen };
  line(ctx, p.knee, plumbEnd, atThree ? '#facc15' : 'rgba(250,204,21,0.45)', (atThree ? 3 : 2) * s, [6 * s, 6 * s]);
  if (atThree) tag(ctx, plumbEnd.x, plumbEnd.y + 16 * s, t('canvas.threeOclock'), '#facc15', s);

  // Hip → ankle "leg line".
  line(ctx, p.hip, p.ankle, 'rgba(96,165,250,0.35)', 1.5 * s, [4 * s, 5 * s]);

  // Skeleton.
  const w = 5 * s;
  line(ctx, p.shoulder, p.elbow, COLORS.arm, w);
  line(ctx, p.elbow, p.wrist, COLORS.arm, w);
  line(ctx, p.shoulder, p.hip, COLORS.torso, w * 1.2);
  line(ctx, p.hip, p.knee, COLORS.leg, w * 1.2);
  line(ctx, p.knee, p.ankle, COLORS.leg, w * 1.2);
  line(ctx, p.ankle, p.heel, COLORS.foot, w * 0.8);
  line(ctx, p.heel, p.toe, COLORS.foot, w * 0.8);
  line(ctx, p.ankle, p.toe, COLORS.foot, w * 0.8);

  // Angle arcs.
  const r = 34 * s;
  const labels = [
    angleArc(ctx, horiz, p.hip, p.shoulder, r * 2.2, st('torso'), `${t('joint.torso')} ${Math.round(m.torso)}°`, s),
    angleArc(ctx, p.shoulder, p.hip, p.knee, r, COLORS.na, `${t('joint.hip')} ${Math.round(m.hip)}°`, s, true),
    angleArc(ctx, p.hip, p.knee, p.ankle, r, COLORS.leg, `${t('joint.knee')} ${Math.round(m.knee)}°`, s),
    angleArc(ctx, p.hip, p.shoulder, p.elbow, r, st('shoulder'), `${t('joint.shoulder')} ${Math.round(m.shoulder)}°`, s),
    angleArc(ctx, p.shoulder, p.elbow, p.wrist, r * 0.8, st('elbow'), `${t('joint.elbow')} ${Math.round(m.elbow)}°`, s),
  ];

  // Joints.
  for (const [k, c] of [
    ['shoulder', COLORS.torso], ['elbow', COLORS.arm], ['wrist', COLORS.arm], ['hip', COLORS.torso],
    ['knee', COLORS.leg], ['ankle', COLORS.leg], ['heel', COLORS.foot], ['toe', COLORS.foot],
  ]) dot(ctx, p[k], 6 * s, c);
  dot(ctx, p.ball, 5 * s, '#facc15');
  placeLabels(ctx, labels, s);

  if (o.kneeMax > 0) {
    const text = t('canvas.maxKnee', { v: Math.round(o.kneeMax) });
    tag(ctx, 12 * s + tagSize(ctx, text, s).w / 2, 24 * s, text, COLORS.leg, s);
  }
  ctx.restore();
}

export function drawMessage(ctx, text) {
  const s = uiScale(ctx.canvas);
  tag(ctx, ctx.canvas.width / 2, 34 * s, text, '#fbbf24', s);
}

/**
 * Calibration markers: wheel diameter, bottom bracket, saddle and hand position.
 * @param c     raw calibration points { wheelA, wheelB, bb, saddle, bar }
 * @param info  { wheelMm, pxPerMm, pending: key of the point being placed }
 */
export function drawCalibration(ctx, c, info = {}) {
  const s = uiScale(ctx.canvas);
  const CAL = '#f472b6';
  const cross = (p, label) => {
    ctx.save();
    ctx.strokeStyle = CAL;
    ctx.lineWidth = 2.5 * s;
    const r = 10 * s;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (label) tag(ctx, p.x, p.y - 26 * s, label, CAL, s);
  };
  if (c.wheelA) cross(c.wheelA, c.wheelB ? null : t('canvas.frontEdge'));
  if (c.wheelA && c.wheelB) {
    cross(c.wheelB, null);
    line(ctx, c.wheelA, c.wheelB, CAL, 2 * s, [8 * s, 5 * s]);
    const mid = { x: (c.wheelA.x + c.wheelB.x) / 2, y: (c.wheelA.y + c.wheelB.y) / 2 };
    tag(ctx, mid.x, mid.y - 18 * s, `⌀ ${info.wheelMm} mm`, CAL, s);
  }
  if (c.bb) cross(c.bb, t('canvas.bb'));
  if (c.saddle) cross(c.saddle, t('canvas.saddle'));
  if (c.bar) cross(c.bar, t('canvas.hands'));
  if (c.bb && c.saddle && info.pxPerMm) {
    line(ctx, c.bb, c.saddle, CAL, 1.5 * s, [4 * s, 5 * s]);
  }
}
