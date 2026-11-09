import { lerp, rotatePt } from '../metrics.js';

const S = 4; // px per cm (0.4 px/mm)
const thigh = 42.9 * S, shank = 43 * S, crank = 17.25 * S;
const bb = { x: 600, y: 700 };
export function sim({ saddleDrop = 0, saddleBack = 0, torsoDeg = 45, rollDeg = 0, frames = 600, noise = 0 }) {
  const hipToBB = 74 * S + saddleDrop * S, st = 73 * Math.PI / 180;
  const hip = { x: bb.x - Math.cos(st) * hipToBB - saddleBack * S, y: bb.y - Math.sin(st) * hipToBB };
  const roll = rollDeg * Math.PI / 180;
  const R = (p) => rotatePt({ ...p, v: 0.9 }, roll);
  const n = () => (Math.random() - 0.5) * 2 * noise;
  const out = [];
  for (let i = 0; i < frames; i++) {
    const t = i / 30, a = t * 1.5 * 2 * Math.PI;
    const pedal = { x: bb.x + Math.cos(a) * crank, y: bb.y + Math.sin(a) * crank };
    const ankle = { x: pedal.x - 10.8 * S, y: pedal.y - 7.4 * S };
    const d = Math.hypot(ankle.x - hip.x, ankle.y - hip.y);
    const ang = Math.atan2(ankle.y - hip.y, ankle.x - hip.x) - Math.acos(Math.min(1, (thigh ** 2 + d ** 2 - shank ** 2) / (2 * thigh * d)));
    const knee = { x: hip.x + Math.cos(ang) * thigh, y: hip.y + Math.sin(ang) * thigh };
    const tr = torsoDeg * Math.PI / 180, tl = 60 * S;
    const shoulder = { x: hip.x + Math.cos(tr) * tl, y: hip.y - Math.sin(tr) * tl };
    const elbow = { x: shoulder.x + 25 * S, y: shoulder.y + 22 * S };
    const wrist = { x: elbow.x + 26 * S, y: elbow.y + 6 * S };
    const heel = { x: ankle.x - 6 * S, y: ankle.y + 6 * S }, toe = { x: ankle.x + 18 * S, y: ankle.y + 8 * S };
    const pts = {};
    for (const [k, v] of Object.entries({ shoulder, elbow, wrist, hip, knee, ankle, heel, toe })) pts[k] = R({ x: v.x + n(), y: v.y + n() });
    pts.ball = lerp(pts.heel, pts.toe, 0.7);
    out.push({ pts, t, confidence: 0.9 });
  }
  const saddle = R({ x: hip.x, y: hip.y + 8 * S });
  const bar = R({ x: hip.x + 55 * S, y: hip.y - 2 * S });
  // front tyre edges (678mm = 67.8cm diameter) at axle height
  const wheelA = R({ x: 1200, y: 640 }), wheelB = R({ x: 1200 - 67.8 * S, y: 640 });
  return { out, saddle, bar, wheelA, wheelB, roll };
}
export function calibFrom({ wheelA, wheelB, saddle, bar }, withBB, rollDeg) {
  let a = Math.atan2(wheelB.y - wheelA.y, wheelB.x - wheelA.x);
  if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
  return { pxPerMm: Math.hypot(wheelB.x - wheelA.x, wheelB.y - wheelA.y) / 678, roll: a, saddle, bar, bb: withBB ? rotatePt(bb, rollDeg * Math.PI / 180) : null };
}
