// Turns a session of per-frame metrics into fit measurements + adjustment suggestions.
// Target ranges are common starting points used in static/dynamic bike fitting,
// not hard rules — flexibility, injuries and goals change what is "right".
// Evidence checked against 2021–2025 literature (Nov 2026):
// - kneeMax: dynamic knee flexion of about 30–40° at full extension (Ferrer-Roca 2012; Bini & Priego-Quesada 2022
//   review favours dynamic measurement; Martínez & Pérez 2025: > 40° flexion linked with more knee pain;
//   Bini et al. 2025: 30–43° proposed, depends on measuring method). Kept at 140–150°.
// - kneeMin: knee range of motion while pedalling is 75 ± 7° (BMC Musculoskelet Disord 2021, 31 adults),
//   so with 145° at the bottom a typical top-of-stroke angle is about 63–77°. Lowered from 65° to 60°.
// - ankleRange: 27 ± 10° in the same 2021 study. 10–40° kept.
// - kops: reviews find no evidence for knee-over-pedal as a precise target (Husband et al. 2024;
//   saddle-position umbrella review 2024). Widened so only large offsets are flagged.
// - torso, hip, shoulder, elbow, hipRock: no 2021–2025 study gives target values (Husband et al. 2024 found no clear
//   recommendations); these remain practitioner rules of thumb (e.g. Burt 2014).

import { t } from './i18n.js';
import { computeMetrics, levelPoints, rotatePt, crankAngle, fitCircle, circleUsable, dist } from './metrics.js';

export const STYLES = {
  comfort:   { torso: [50, 70], hipMin: 55, shoulder: [70, 90] },
  endurance: { torso: [40, 52], hipMin: 48, shoulder: [80, 95] },
  race:      { torso: [30, 42], hipMin: 42, shoulder: [85, 100] },
};

const SADDLE_TARGET_KNEE = 145;
// Drillis & Contini segment ratios: thigh ≈ 0.245 × height, shank ≈ 0.246 × height.
const LEG_TO_HEIGHT = 0.491;

export function liveRanges(style) {
  const s = STYLES[style] ?? STYLES.endurance;
  return {
    kneeMax: { range: [140, 150], tol: 5 },
    kneeMin: { range: [60, null], tol: 5 },
    hipMin: { range: [s.hipMin, null], tol: 5 },
    torso: { range: s.torso, tol: 5 },
    shoulder: { range: s.shoulder, tol: 7 },
    elbow: { range: [145, 168], tol: 7 },
  };
}

export function rate(value, range, tol) {
  if (value == null || !Number.isFinite(value)) return 'na';
  const [lo, hi] = range;
  const off = Math.max(lo != null ? lo - value : -Infinity, hi != null ? value - hi : -Infinity);
  if (off <= 0) return 'good';
  if (off <= tol) return 'close';
  return 'bad';
}

export function dirOf(value, range) {
  const [lo, hi] = range;
  if (lo != null && value < lo) return 'low';
  if (hi != null && value > hi) return 'high';
  return null;
}

export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = ((a.length - 1) * p) / 100;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

const median = (arr) => percentile(arr, 50);
const legReach = (a, b, deg) => Math.sqrt(a * a + b * b - 2 * a * b * Math.cos((deg * Math.PI) / 180));

function formatRange([lo, hi], unit) {
  if (lo != null && hi != null) return lo === -hi ? `±${hi}${unit}` : `${lo}–${hi}${unit}`;
  if (lo != null) return `≥ ${lo}${unit}`;
  return `≤ ${hi}${unit}`;
}

const rollingMedian = (arr, i, half) => median(arr.slice(Math.max(0, i - half), i + half + 1));
const bodyLen = (p) => dist(p.shoulder, p.hip) + dist(p.hip, p.knee) + dist(p.knee, p.ankle);
const POINT_KEYS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe', 'ball'];

/**
 * Footage filmed outdoors or with a hand-held / following camera: the bike drifts across the frame and
 * grows or shrinks as it nears the camera. Detect that, then map every frame into one reference frame
 * anchored on the hands (they hold the bars, so they move with the bike) and scaled by body length
 * (constant in a side view). On a fixed trainer shot this is a no-op.
 */
export function stabilize(samples) {
  const n = samples.length;
  if (n < 30) return { samples, moving: false };
  const ax = samples.map((s) => s.pts.wrist.x);
  const ay = samples.map((s) => s.pts.wrist.y);
  const len = samples.map((s) => bodyLen(s.pts));
  const L0 = median(len);
  if (!(L0 > 0)) return { samples, moving: false };
  const spread = Math.max(percentile(ax, 95) - percentile(ax, 5), percentile(ay, 95) - percentile(ay, 5)) / L0;
  const sizeChange = percentile(len, 95) / percentile(len, 5);
  if (spread < 0.12 && sizeChange < 1.08) return { samples, moving: false };

  const A0 = { x: median(ax), y: median(ay) };
  const out = samples.map((s, i) => {
    // Light smoothing on the anchor (pose jitter), heavier on the scale (it changes slowly).
    const A = { x: rollingMedian(ax, i, 2), y: rollingMedian(ay, i, 2) };
    const k = L0 / rollingMedian(len, i, 15);
    const pts = {};
    for (const key of POINT_KEYS) {
      const p = s.pts[key];
      pts[key] = { x: A0.x + (p.x - A.x) * k, y: A0.y + (p.y - A.y) * k, v: p.v };
    }
    return { ...s, pts };
  });
  return { samples: out, moving: true };
}

function estimateCadence(samples) {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const ys = sorted.map((s) => s.footY);
  const mid = median(ys);
  const band = (percentile(ys, 95) - percentile(ys, 5)) * 0.2;
  if (!(band > 0)) return null;
  let phase = 0;
  const bottoms = [];
  for (const s of sorted) {
    const d = s.footY - mid;
    if (phase !== 1 && d > band) {
      phase = 1;
      bottoms.push(s.t);
    } else if (phase !== -1 && d < -band) {
      phase = -1;
    }
  }
  if (bottoms.length < 3) return null;
  const span = bottoms[bottoms.length - 1] - bottoms[0];
  return span > 0 ? ((bottoms.length - 1) / span) * 60 : null;
}

export const SCALE_SOURCES = {
  wheel: { label: 'scale.wheel', accuracy: 'acc.high' },
  crank: { label: 'scale.crank', accuracy: 'acc.medium' },
  height: { label: 'scale.height', accuracy: 'acc.low' },
};

/**
 * @param samples  [{ pts, t, confidence }] — raw (un-levelled) image points per frame
 * @param opts     { style, heightCm, crankMm, calib: { pxPerMm, roll, bb, saddle, bar } }
 */
export function analyzeSession(samples, { style = 'endurance', heightCm = null, crankMm = 172.5, calib = {} } = {}) {
  const stab = stabilize(samples.filter((s) => s.confidence >= 0.5));
  // Calibration clicks belong to a single frame; once the bike moves they no longer line up.
  if (stab.moving) calib = {};
  const roll = calib.roll ?? 0;
  const lv = (p) => (p ? rotatePt(p, -roll) : null);
  const good = stab.samples
    .map((s) => {
      const p = levelPoints(s.pts, roll);
      return { p, t: s.t, ...computeMetrics(p) };
    })
    .filter((s) => Number.isFinite(s.knee));
  if (good.length < 30) {
    return {
      ok: false,
      sampleCount: good.length,
      reason: t('a.notEnough'),
    };
  }

  const col = (k) => good.map((s) => s[k]).filter(Number.isFinite);
  const dir = good.filter((s) => s.dir > 0).length >= good.length / 2 ? 1 : -1;
  const thigh = percentile(col('thigh'), 90);
  const shank = percentile(col('shank'), 90);
  const notes = [];
  const note = (id, params) => notes.push({ id, text: t(`a.${id}`, params) });

  // ---- Bottom bracket + scale ----
  const circle = fitCircle(good.map((s) => s.p.ball));
  const circleOk = circleUsable(circle);
  let pxPerMm = null;
  let scaleSource = null;
  if (calib.pxPerMm) {
    pxPerMm = calib.pxPerMm;
    scaleSource = 'wheel';
  } else if (circleOk) {
    pxPerMm = circle.r / crankMm;
    scaleSource = 'crank';
  } else if (heightCm > 0) {
    pxPerMm = (thigh + shank) / (heightCm * 10 * LEG_TO_HEIGHT);
    scaleSource = 'height';
  }
  const bbManual = lv(calib.bb);
  const bb = bbManual ?? (circleOk ? { x: circle.x, y: circle.y } : null);
  const bbSource = bbManual ? 'manual' : bb ? 'auto' : null;
  const crankPx = pxPerMm ? crankMm * pxPerMm : circleOk ? circle.r : null;

  if (stab.moving) note('noteMoving');
  if (Math.abs(roll) > (1 * Math.PI) / 180) note('noteRoll', { deg: ((roll * 180) / Math.PI).toFixed(1) });
  if (scaleSource === 'wheel' && circleOk) {
    const measured = circle.r / pxPerMm;
    const diff = ((measured - crankMm) / crankMm) * 100;
    const params = { m: measured.toFixed(0), c: crankMm, d: Math.abs(diff).toFixed(0) };
    note(Math.abs(diff) > 10 ? 'noteCrankOff' : 'noteCrankOk', params);
  }
  if (!bb) note('noteNoBB');
  if (!scaleSource) note('noteNoScale');
  else if (scaleSource === 'height') note('noteHeightScale');

  const kneeMax = percentile(col('knee'), 95);
  const kneeMin = percentile(col('knee'), 5);
  const hipMin = percentile(col('hip'), 5);
  const torso = median(col('torso'));
  const shoulder = median(col('shoulder'));
  const elbow = median(col('elbow'));
  const ankleRange = percentile(col('ankle'), 95) - percentile(col('ankle'), 5);
  // With a moving camera, a few mm of hip bounce can't be told apart from camera shake: don't guess.
  const hipRock = stab.moving ? NaN : ((percentile(col('hipY'), 95) - percentile(col('hipY'), 5)) / thigh) * 100;

  // ---- Crank-angle based measurements ----
  let curve = null;
  let kopsPx = null;
  let kopsMethod = 'estimate';
  if (bb) {
    for (const s of good) s.crank = crankAngle(s.p.ball, bb, s.dir);
    const at3 = good.filter((s) => Math.abs(s.crank - 90) <= 8);
    if (at3.length >= 5 && crankPx) {
      kopsPx = median(at3.map((s) => (s.p.knee.x - (bb.x + s.dir * crankPx)) * s.dir));
      kopsMethod = 'crank';
    }
    const BIN = 15;
    const bins = Array.from({ length: 360 / BIN }, () => []);
    for (const s of good) bins[Math.floor(s.crank / BIN) % bins.length].push(s);
    curve = bins
      .map((arr, i) => ({ deg: i * BIN + BIN / 2, n: arr.length, knee: median(arr.map((s) => s.knee)), hip: median(arr.map((s) => s.hip)) }))
      .filter((b) => b.n >= 3);
    if (curve.length < 12) curve = null;
  }
  if (kopsPx == null) {
    // Fallback: frames where the foot is furthest forward (~3 o'clock).
    const ffCut = percentile(col('footForward'), 90);
    kopsPx = median(good.filter((s) => s.footForward >= ffCut).map((s) => s.kneeOverBall));
  }
  const kopsInCm = pxPerMm != null;
  const kops = kopsInCm ? kopsPx / pxPerMm / 10 : (kopsPx / shank) * 100;

  // ---- Bike measurements (need BB + scale) ----
  let bike = null;
  if (bb && pxPerMm) {
    const mm = (px) => px / pxPerMm;
    bike = {};
    const sd = lv(calib.saddle);
    const bar = lv(calib.bar);
    if (sd) {
      bike.saddleHeight = mm(dist(sd, bb));
      bike.saddleSetback = mm((bb.x - sd.x) * dir);
    }
    if (bar) {
      bike.handStack = mm(bb.y - bar.y);
      bike.handReach = mm((bar.x - bb.x) * dir);
    }
    if (sd && bar) {
      bike.saddleBarDrop = mm(bar.y - sd.y);
      bike.saddleBarReach = mm((bar.x - sd.x) * dir);
    }
    if (!Object.keys(bike).length) bike = null;
  }

  const cadence = estimateCadence(good);
  const R = liveRanges(style);
  const kopsSpec = kopsInCm ? { range: [-3, 3], tol: 2, unit: ' cm' } : { range: [-8, 8], tol: 4, unit: t('unit.pctShank') };

  const metric = (key, value, spec, unit, helpKey = `m.${key}Help`, decimals = 0) => ({
    key,
    label: t(`m.${key}`),
    value,
    unit,
    decimals,
    help: t(helpKey),
    target: formatRange(spec.range, unit),
    range: spec.range,
    tol: spec.tol,
    status: rate(value, spec.range, spec.tol),
    dir: dirOf(value, spec.range),
  });

  const metrics = [
    metric('kneeMax', kneeMax, R.kneeMax, '°'),
    metric('kneeMin', kneeMin, R.kneeMin, '°'),
    metric('hipMin', hipMin, R.hipMin, '°'),
    metric('torso', torso, R.torso, '°'),
    metric('shoulder', shoulder, R.shoulder, '°'),
    metric('elbow', elbow, R.elbow, '°'),
    metric('kops', kops, kopsSpec, kopsSpec.unit, kopsMethod === 'crank' ? 'm.kopsHelpCrank' : 'm.kopsHelpEst', 1),
    metric('hipRock', hipRock, { range: [null, 8], tol: 4 }, t('unit.pctThigh'), stab.moving ? 'm.hipRockMovingHelp' : undefined, 1),
    metric('ankleRange', ankleRange, { range: [10, 40], tol: 8 }, '°'),
  ];

  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
  const heightDeltaMm =
    pxPerMm != null ? Math.round((legReach(thigh, shank, SADDLE_TARGET_KNEE) - legReach(thigh, shank, kneeMax)) / pxPerMm) : null;

  return {
    ok: true,
    sampleCount: good.length,
    style,
    styleLabel: t(`style.${STYLES[style] ? style : 'endurance'}`),
    cadence,
    metrics,
    scale: { source: scaleSource, pxPerMm },
    bbSource,
    moving: stab.moving,
    kopsMethod,
    curve,
    bike,
    heightDeltaMm,
    notes,
    suggestions: buildSuggestions(byKey, { heightDeltaMm, kopsInCm, saddleHeight: bike?.saddleHeight ?? null }),
  };
}

function buildSuggestions(m, { heightDeltaMm, kopsInCm, saddleHeight }) {
  const out = [];
  // id is stable across languages; text is rendered in the current language.
  const add = (id, priority, area, body, action, title = t(`s.${id}`)) =>
    out.push({ id, priority, area: t(`area.${area}`), title, body, action });
  const v = (k) => Math.round(m[k].value);
  // Only clearly out-of-range values ('bad') trigger secondary suggestions; borderline ones show in the table.
  const off = (k) => (m[k].status === 'bad' ? m[k].dir : null);
  const mmStep = (mm, verbKey) => {
    const verb = t(verbKey);
    if (mm == null) return t('step.none', { verb });
    return t(Math.abs(mm) > 10 ? 'step.big' : 'step.small', { verb, mm: Math.abs(mm) });
  };
  const saddleTarget = (mm) =>
    mm != null && saddleHeight != null
      ? t('step.target', { now: Math.round(saddleHeight), target: Math.round(saddleHeight + mm) })
      : '';

  // 1. Saddle height — always fix this first.
  if (m.kneeMax.dir === 'low') {
    add('saddleUp', 1, 'saddleHeight', t('s.saddleUpBody', { v: v('kneeMax') }),
      mmStep(heightDeltaMm, 'verb.raise') + saddleTarget(heightDeltaMm));
  } else if (m.kneeMax.dir === 'high') {
    add('saddleDown', 1, 'saddleHeight', t('s.saddleDownBody', { v: v('kneeMax'), rock: m.hipRock.status === 'close' || m.hipRock.status === 'bad' }),
      mmStep(heightDeltaMm, 'verb.lower') + saddleTarget(heightDeltaMm));
  } else if (m.hipRock.status === 'bad') {
    add('hipRock', 2, 'saddleHeight', t('s.hipRockBody', { v: v('kneeMax'), pct: m.hipRock.value.toFixed(1) }),
      t('s.hipRockAction'));
  }

  if (off('kneeMin') === 'low' || (m.kneeMin.dir === 'low' && !m.kneeMax.dir)) {
    add('crankLong', 3, 'cranks', t('s.crankLongBody', { v: v('kneeMin'), hip: m.hipMin.dir === 'low' }),
      t('s.crankLongAction'));
  }

  // 2. Saddle fore/aft.
  if (off('kops')) {
    const ahead = m.kops.dir === 'high';
    const amt = Math.abs(m.kops.value);
    const big = kopsInCm ? amt > 3 : amt > 8;
    const qty = kopsInCm ? t('s.kopsCm', { x: amt.toFixed(1) }) : t('s.kopsPct', { x: amt.toFixed(0) });
    const verb = t(ahead ? 'verb.back' : 'verb.forward');
    add(ahead ? 'kopsBack' : 'kopsForward', 2, 'saddleFore',
      t('s.kopsBody', { ahead, qty }),
      big ? t('s.kopsBig', { verb }) : t('s.kopsSmall', { verb, ahead, mm: kopsInCm ? Math.round(amt * 10) : null }),
      verb);
  }

  // 3. Handlebar reach & drop.
  const reachLong = off('elbow') === 'high' || off('shoulder') === 'high';
  const reachShort = off('elbow') === 'low' || off('shoulder') === 'low';
  if (reachLong && !reachShort) {
    add('reachLong', 3, 'reach',
      t('s.reachLongBody', { s: v('shoulder'), e: v('elbow'), straight: m.elbow.dir === 'high' }),
      t('s.reachLongAction'));
  } else if (reachShort && !reachLong) {
    add('reachShort', 3, 'reach', t('s.reachShortBody', { s: v('shoulder'), e: v('elbow') }), t('s.reachShortAction'));
  }

  const tooLow = off('torso') === 'low' || off('hipMin') === 'low';
  if (tooLow) {
    add('barsUp', 2, 'barHeight', t('s.barsUpBody', { t: v('torso'), h: v('hipMin') }), t('s.barsUpAction'));
  } else if (off('torso') === 'high') {
    add('upright', 4, 'barHeight', t('s.uprightBody', { t: v('torso') }), t('s.uprightAction'));
  }

  if (off('ankleRange') === 'high') {
    add('ankle', 4, 'feet', t('s.ankleBody', { v: v('ankleRange') }), t('s.ankleAction'));
  }

  out.sort((a, b) => a.priority - b.priority);
  return out;
}
