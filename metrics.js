// Geometry + per-frame metrics computed from MediaPipe pose landmarks.
// All angles are interior angles in degrees. Image coordinates: y grows downward.

export const IDX = {
  left:  { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

const JOINTS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];
const KEY_JOINTS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'toe'];

// Ball of foot (≈ pedal spindle with a normal cleat) as a fraction from heel to toe tip.
export const BALL_OF_FOOT = 0.7;

/** > 0 when the rider's LEFT side is the one nearest the camera. */
export function sideScore(lms) {
  let s = 0;
  for (const j of ['shoulder', 'hip', 'knee', 'ankle']) {
    const l = lms[IDX.left[j]];
    const r = lms[IDX.right[j]];
    s += r.z - l.z; // smaller z = closer to camera
    s += 0.5 * ((l.visibility ?? 0) - (r.visibility ?? 0));
  }
  return s;
}

export function extractPoints(lms, side, width, height) {
  const pts = {};
  for (const j of JOINTS) {
    const l = lms[IDX[side][j]];
    pts[j] = { x: l.x * width, y: l.y * height, v: l.visibility ?? 1 };
  }
  pts.ball = lerp(pts.heel, pts.toe, BALL_OF_FOOT);
  return pts;
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, v: Math.min(a.v, b.v) };
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!d) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function computeMetrics(p) {
  // Hands are always ahead of the hips on a bike → tells us which way the rider faces.
  const dir = p.wrist.x >= p.hip.x ? 1 : -1;
  return {
    dir,
    knee: angleAt(p.hip, p.knee, p.ankle),
    hip: angleAt(p.shoulder, p.hip, p.knee),
    elbow: angleAt(p.shoulder, p.elbow, p.wrist),
    shoulder: angleAt(p.hip, p.shoulder, p.elbow),
    ankle: angleAt(p.knee, p.ankle, p.toe),
    torso: (Math.atan2(p.hip.y - p.shoulder.y, Math.abs(p.shoulder.x - p.hip.x)) * 180) / Math.PI,
    footForward: (p.ball.x - p.hip.x) * dir, // largest ≈ crank at 3 o'clock
    kneeOverBall: (p.knee.x - p.ball.x) * dir, // > 0: knee ahead of ball of foot
    thigh: dist(p.hip, p.knee),
    shank: dist(p.knee, p.ankle),
    hipY: p.hip.y,
    footY: p.ball.y,
    confidence: Math.min(...KEY_JOINTS.map((j) => p[j].v)),
  };
}

/** Exponential smoothing of points, for a steadier on-screen overlay. */
export class PointSmoother {
  constructor(alpha = 0.55) {
    this.alpha = alpha;
    this.prev = null;
  }
  reset() {
    this.prev = null;
  }
  apply(p) {
    if (!this.prev) {
      this.prev = structuredClone(p);
      return this.prev;
    }
    const a = this.alpha;
    const out = {};
    for (const k of Object.keys(p)) {
      const q = this.prev[k];
      out[k] = { x: q.x + (p[k].x - q.x) * a, y: q.y + (p[k].y - q.y) * a, v: p[k].v };
    }
    this.prev = out;
    return out;
  }
}

// ---------- Bike geometry helpers ----------

/** Rotate a point about the origin by `ang` radians. */
export function rotatePt(p, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, v: p.v };
}

/** Remove camera roll so "horizontal" in the returned points is true horizontal. */
export function levelPoints(p, roll) {
  if (!roll) return p;
  const out = {};
  for (const k of Object.keys(p)) out[k] = rotatePt(p[k], -roll);
  return out;
}

/** Clock-face crank angle in degrees: 0 = 12 o'clock, 90 = 3 o'clock (forward), 180 = 6 o'clock. */
export function crankAngle(ball, bb, dir) {
  const a = (Math.atan2(ball.y - bb.y, (ball.x - bb.x) * dir) * 180) / Math.PI;
  return (a + 90 + 360) % 360;
}

function fitCircleOnce(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    Suu += u * u; Suv += u * v; Svv += v * v;
    Suuu += u * u * u; Svvv += v * v * v; Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = 0.5 * (Suuu + Suvv), b2 = 0.5 * (Svvv + Svuu);
  const uc = (b1 * Svv - b2 * Suv) / det;
  const vc = (Suu * b2 - Suv * b1) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  return { x: uc + mx, y: vc + my, r };
}

/**
 * Least-squares circle fit (Bullock/Kåsa) with one outlier-rejection pass.
 * Used on the ball-of-foot path: centre ≈ bottom bracket, radius ≈ crank length.
 */
export function fitCircle(points) {
  if (points.length < 12) return null;
  let c = fitCircleOnce(points);
  if (!c) return null;
  const resid = (pts, k) => pts.map((p) => Math.hypot(p.x - k.x, p.y - k.y) - k.r);
  const rms = (arr) => Math.sqrt(arr.reduce((a, d) => a + d * d, 0) / arr.length);
  const e = rms(resid(points, c));
  const kept = points.filter((p) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - c.r) <= 2.5 * e);
  if (kept.length >= 12 && kept.length < points.length) c = fitCircleOnce(kept) ?? c;
  const used = kept.length >= 12 ? kept : points;
  const bins = new Set(used.map((p) => Math.floor(((Math.atan2(p.y - c.y, p.x - c.x) + Math.PI) / (2 * Math.PI)) * 12) % 12));
  return { ...c, rms: rms(resid(used, c)), coverage: bins.size / 12, n: used.length };
}

// Many points around the whole circle pin the centre down even when each point is noisy
// (e.g. a small rider in portrait phone footage), so allow more scatter there.
export const circleUsable = (c) =>
  !!c && c.coverage >= 0.75 && c.rms / c.r < (c.n >= 150 && c.coverage >= 0.9 ? 0.25 : 0.2);
