import {
  sideScore, extractPoints, computeMetrics, captureQuality, PointSmoother, levelPoints, rotatePt, crankAngle, fitCircle, circleUsable,
} from './metrics.js';
import { analyzeSession, liveRanges, rate, SCALE_SOURCES } from './analysis.js';
import { drawOverlay, drawMessage, drawCalibration } from './draw.js';
import { curveChart, mountCharts } from './chart.js';
import { mountRiderDemo } from './rider-demo.js';
import { t, getLang, setLang, onLangChange, applyStatic, LANGS, DICTS } from './i18n.js';

// Usage events for Google Analytics (no-op when GA is blocked or not loaded). Never send video or body data.
const track = (name, params = {}) => { try { window.gtag?.('event', name, params); } catch { /* analytics must never break the app */ } };

// Loaded on demand so a CDN failure can be reported and retried instead of breaking the whole page.
const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const SLOW_MODEL_MS = 15000;
const LONG_VIDEO_S = 90;
const MAX_CANVAS_PX = 1280;
// A test ends by itself once it has enough clean pedal strokes for stable stroke extremes
// (about 15 s at 80 rpm), never before MIN_TEST_S and never after MAX_TEST_S.
const TARGET_STROKES = 20;
const MIN_TEST_S = 8;
const MAX_TEST_S = 45;

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const riderDemo = mountRiderDemo($('riderDemo'));

const state = {
  landmarker: null,
  modelLoading: false,
  status: { key: 'status.loading', cls: '' },
  toast: null, // { key, params, type, action: { key, run } }
  source: null, // 'camera' | 'file'
  cameraStarting: false,
  stream: null,
  fileUrl: null,
  lastVideoTime: -1,
  lastTs: 0,
  sideScore: 0,
  side: 'left',
  smoother: new PointSmoother(0.55),
  trail: [],
  phase: 'idle', // 'idle' | 'countdown' | 'collecting'
  samples: [],
  lastSamples: null,
  best: { knee: -1, img: null },
  front: { err: Infinity, ff: -Infinity, img: null },
  sessionKneeMax: 0,
  calib: {}, // raw image points: wheelA, wheelB, bb, saddle, bar
  calibPrev: null,
  calibStep: -1,
  ballBuf: [],
  liveCircle: null,
  frameNo: 0,
  footForwardPeak: 0,
  recorder: null,
  recordingUrl: null,
  recordUnsupported: false,
  detectErrorLogged: false,
  timers: [],
  sessionStart: 0,
  lastLiveUpdate: 0,
  style: (() => {
    try { return localStorage.getItem('bikefit.style'); } catch { return null; }
  })() ?? 'endurance',
};
const STYLES_ORDER = ['comfort', 'endurance', 'race'];

/** A number field's value when it is inside [lo, hi], else null (an invalid entry is ignored, never guessed at). */
function numIn(id, lo, hi) {
  const raw = $(id).value.trim();
  const v = parseFloat(raw);
  return raw !== '' && v >= lo && v <= hi ? v : null;
}

const settings = () => ({
  style: state.style,
  heightCm: heightCm(),
  side: 'auto', // detected from the pose; the side nearest the camera
  record: true,
  wheelMm: $('wheel').value === 'custom' ? numIn('wheelCustom', 400, 800) : parseFloat($('wheel').value),
  crankMm: parseFloat($('crank').value),
});

// ---------- Height: centimeters or feet + inches ----------
const IN_CM = 2.54;
const HEIGHT_UNIT_KEY = 'bikefit.heightUnit';
const storedUnit = () => {
  try { return localStorage.getItem(HEIGHT_UNIT_KEY); } catch { return null; }
};
let heightUnit = storedUnit() ?? (/^en-(US|LR|MM)$/i.test(navigator.language) ? 'imp' : 'cm');

/** Raw height in cm from whichever inputs are showing, or null when empty / incomplete. */
function rawHeightCm() {
  if (heightUnit === 'cm') {
    const raw = $('height').value.trim();
    return raw === '' ? null : parseFloat(raw);
  }
  const ft = $('heightFt').value.trim();
  const inch = $('heightIn').value.trim();
  if (ft === '' && inch === '') return null;
  const total = (parseFloat(ft) || 0) * 12 + (parseFloat(inch) || 0);
  return total * IN_CM;
}

/** Height in cm when inside 120–220 cm, else null (an invalid entry is ignored, never guessed at). */
function heightCm() {
  const v = rawHeightCm();
  return v != null && v >= 120 && v <= 220 ? Math.round(v * 10) / 10 : null;
}

function validateHeight() {
  const v = rawHeightCm();
  const ok = v == null || heightCm() != null;
  for (const id of ['height', 'heightFt', 'heightIn']) $(id).setAttribute('aria-invalid', String(!ok));
  $('heightErr').hidden = ok;
}

/** Switch units, carrying the current value across so nothing has to be retyped. */
function setHeightUnit(unit) {
  const cm = rawHeightCm();
  heightUnit = unit;
  try { localStorage.setItem(HEIGHT_UNIT_KEY, unit); } catch {}
  if (cm != null && Number.isFinite(cm)) {
    if (unit === 'cm') $('height').value = Math.round(cm);
    else {
      const totalIn = Math.round((cm / IN_CM) * 2) / 2; // nearest half inch
      $('heightFt').value = Math.floor(totalIn / 12);
      $('heightIn').value = totalIn - Math.floor(totalIn / 12) * 12;
    }
  }
  renderHeightUnit();
  validateHeight();
}

function renderHeightUnit() {
  $('heightCmBox').hidden = heightUnit !== 'cm';
  $('heightImpBox').hidden = heightUnit === 'cm';
  for (const b of $('heightUnit').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.unit === heightUnit));
}

/** Show or clear the inline error under a number field. Empty is valid (the field is optional). */
function validateField(id, lo, hi) {
  const el = $(id);
  const raw = el.value.trim();
  const ok = raw === '' || numIn(id, lo, hi) != null;
  el.setAttribute('aria-invalid', String(!ok));
  $(`${id}Err`).hidden = ok;
}

// ---------- Status & messages ----------

function setStatus(key, cls = '') {
  state.status = { key, cls };
  renderStatus();
}

function renderStatus() {
  const el = $('modelStatus');
  el.textContent = t(state.status.key);
  el.className = `pill ${state.status.cls}`;
}

/** key = null clears. type 'error' | 'info'. action = { key, run } adds a button (e.g. retry). */
function toast(key, params = {}, { type = 'error', action = null } = {}) {
  state.toast = key ? { key, params, type, action } : null;
  renderToast();
}

function renderToast() {
  const m = state.toast;
  const el = $('toast');
  el.hidden = !m;
  if (!m) return;
  el.className = `toast ${m.type === 'info' ? 'info' : ''}`;
  el.setAttribute('role', m.type === 'info' ? 'status' : 'alert');
  $('toastText').textContent = t(m.key, m.params);
  const btn = $('toastAction');
  btn.hidden = !m.action;
  if (m.action) {
    btn.textContent = t(m.action.key);
    btn.onclick = m.action.run;
  }
}

// ---------- Model ----------

async function initModel() {
  if (state.modelLoading || state.landmarker) return;
  state.modelLoading = true;
  if (state.toast?.key === 'err.model') toast(null);
  setStatus('status.loading');
  const slow = setTimeout(() => {
    setStatus('status.slow');
    if (!state.toast) toast('err.slowModel', {}, { type: 'info' });
  }, SLOW_MODEL_MS);
  try {
    const { FilesetResolver, PoseLandmarker } = await import(VISION_URL);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const create = (delegate) =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      state.landmarker = await create('GPU');
    } catch (e) {
      console.warn('GPU delegate failed, falling back to CPU', e);
      state.landmarker = await create('CPU');
    }
    setStatus('status.ready', 'ok');
    if (state.toast?.key === 'err.slowModel') toast(null);
  } catch (e) {
    console.error(e);
    setStatus('status.failed', 'err');
    toast('err.model', {}, { action: { key: 'action.retry', run: initModel } });
  } finally {
    clearTimeout(slow);
    state.modelLoading = false;
    updateButtons();
    redraw();
  }
}

// ---------- Sources ----------

function cameraError(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return ['err.cameraDenied'];
    case 'NotFoundError':
    case 'OverconstrainedError':
      return ['err.cameraNotFound'];
    case 'NotReadableError':
    case 'AbortError':
      return ['err.cameraBusy'];
    default:
      return ['err.cameraOther', { name: e?.name || 'Error' }];
  }
}

async function startCamera() {
  if (state.cameraStarting) return;
  if (!window.isSecureContext) return toast('err.cameraInsecure');
  if (!navigator.mediaDevices?.getUserMedia) return toast('err.cameraUnsupported');
  state.cameraStarting = true;
  track('camera_start');
  updateButtons();
  stopSource();
  toast(null);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    state.source = 'camera';
    // Unplugged camera or revoked permission: keep what was captured, then explain.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (state.stream !== stream) return;
      if (state.phase === 'collecting') endSession(true);
      stopSource();
      toast('err.cameraEnded');
    });
    onSourceReady();
  } catch (e) {
    console.error(e);
    stopSource();
    const [key, params] = cameraError(e);
    toast(key, params);
  } finally {
    state.cameraStarting = false;
    updateButtons();
  }
}

/** MediaRecorder WebM files report Infinity until the end has been seen; seek there once to learn the length. */
function resolveDuration() {
  if (Number.isFinite(video.duration)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('durationchange', check);
      clearTimeout(timer);
      video.currentTime = 0;
      resolve();
    };
    const check = () => Number.isFinite(video.duration) && done();
    const timer = setTimeout(done, 3000);
    video.addEventListener('durationchange', check);
    video.currentTime = 1e7;
  });
}

function loadFile(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith('video/')) return toast('err.notVideo');
  stopSource();
  toast(null);
  state.fileUrl = URL.createObjectURL(file);
  const url = state.fileUrl;
  video.srcObject = null;
  video.src = url;
  video.loop = false;
  video.muted = true;
  video.onloadeddata = async () => {
    video.onloadeddata = null;
    await resolveDuration();
    if (state.fileUrl !== url) return; // replaced while we waited
    state.source = 'file';
    video.pause();
    video.currentTime = 0;
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    $('seek').max = dur || 1;
    if (dur > LONG_VIDEO_S) {
      toast('info.longVideo', { min: (dur / 60).toFixed(1) }, { type: 'info' });
    }
    onSourceReady();
  };
  video.onerror = () => {
    if (state.fileUrl !== url) return;
    stopSource();
    toast('err.videoFormat');
  };
}

function onSourceReady() {
  $('placeholder').hidden = true;
  riderDemo.stop();
  $('fileControls').hidden = state.source !== 'file';
  state.lastVideoTime = -1;
  state.smoother.reset();
  state.trail = [];
  state.sideScore = 0;
  state.calib = {};
  state.ballBuf = [];
  state.liveCircle = null;
  state.footForwardPeak = 0;
  state.qualWin = [];
  renderSetupCheck();
  renderCalibStatus();
  updateButtons();
  if (state.source === 'file') syncFileControls();
}

function stopSource() {
  if (state.phase !== 'idle') endSession(false);
  if (state.calibStep >= 0) closeCalib();
  state.stream?.getTracks().forEach((tr) => tr.stop());
  state.stream = null;
  video.onerror = null;
  video.onloadeddata = null;
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
  video.load();
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.fileUrl = null;
  state.source = null;
  $('placeholder').hidden = false;
  fitStage(0, 0);
  canvas.width = 300;
  canvas.height = 150;
  riderDemo.start();
  $('fileControls').hidden = true;
  state.qualWin = [];
  renderSetupCheck();
  renderLiveEmpty();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateButtons();
}

function updateButtons() {
  const busy = state.phase !== 'idle';
  // One button runs the test: start, and while a test runs, cancel it.
  const session = $('btnSession');
  session.disabled = !state.source || !state.landmarker || state.calibStep >= 0;
  session.textContent = t(busy ? 'btn.cancelTest' : state.source === 'file' ? 'btn.analyzeVideo' : 'btn.startFit');
  session.classList.toggle('primary', !busy);
  // The camera button doubles as the off switch, so there is no separate Stop.
  $('btnCamera').disabled = busy || state.cameraStarting;
  $('btnCamera').textContent = t(state.source === 'camera' ? 'btn.cameraOff' : 'btn.camera');
  // Upload is a <label>: disabling its input blocks the picker; aria-disabled carries the state to the label.
  $('fileInput').disabled = busy;
  $('btnUpload').setAttribute('aria-disabled', String(busy));
  $('btnCalib').disabled = !state.source || busy || state.calibStep >= 0;
  $('testHint').hidden = !state.source || busy;
}

// ---------- Frame loop ----------

// ---------- Analysis speed ----------
// Uploaded videos are analyzed while they play. The speed is chosen automatically: as fast as the device can
// keep up with while still analyzing ~30 frames per second of video (≈ 20 per pedal stroke at 90 rpm),
// so a fast computer runs at 1× and a slower phone slows the video down instead of skipping frames.
const FRAMES_PER_VIDEO_S = 30;
const MIN_RATE = 0.25;
const HAS_RVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

function autoRate() {
  const cost = state.frameCostMs;
  if (!cost) return 0.5; // nothing measured yet: a safe middle until the first second of data
  const perSecond = 1000 / cost;
  const rate = Math.min(1, Math.max(MIN_RATE, perSecond / FRAMES_PER_VIDEO_S));
  return Math.round(rate * 20) / 20;
}

// Count each decoded frame exactly once (no repeats when a 120 Hz screen redraws the same frame).
if (HAS_RVFC) {
  const onFrame = () => {
    state.frameSeq = (state.frameSeq ?? 0) + 1;
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

function loop() {
  requestAnimationFrame(loop);
  if (!state.source || video.readyState < 2) return;
  const time = video.currentTime;
  if (time === state.lastVideoTime) return;
  // While a video plays, wait for a genuinely new frame; paused seeks and redraws go straight through.
  if (HAS_RVFC && !video.paused && state.lastVideoTime >= 0) {
    if (state.frameSeq === state.lastFrameSeq) return;
  }
  state.lastFrameSeq = state.frameSeq;
  if (state.source === 'file' && Math.abs(time - state.lastVideoTime) > 0.5) {
    state.smoother.reset();
    state.trail = [];
  }
  state.lastVideoTime = time;
  const t0 = performance.now();
  processFrame();
  const cost = performance.now() - t0;
  // The first frames include model warm-up; cap the seed so one slow start does not drag the speed down.
  state.frameCostMs = state.frameCostMs ? state.frameCostMs * 0.9 + cost * 0.1 : Math.min(cost, 40);
  if (state.source === 'file') {
    // Re-tune the analysis speed about once a second as the cost settles.
    if (state.phase === 'collecting' && performance.now() - (state.lastRateTune ?? 0) > 1000) {
      state.lastRateTune = performance.now();
      video.playbackRate = autoRate();
    }
    syncFileControls();
  }
}

function detect(ts) {
  try {
    return state.landmarker.detectForVideo(video, ts);
  } catch (e) {
    // e.g. a lost GPU context; skip the frame rather than stopping the loop.
    if (!state.detectErrorLogged) console.error('Pose detection failed', e);
    state.detectErrorLogged = true;
    return null;
  }
}

// The stage takes the footage's shape, so portrait phone video is shown whole instead of cropped.
function fitStage(w, h) {
  const stage = $('stage');
  if (!w || !h) {
    stage.style.removeProperty('--ar');
    stage.classList.remove('portrait');
    return;
  }
  stage.style.setProperty('--ar', `${w} / ${h}`);
  stage.classList.toggle('portrait', h > w);
}

function processFrame() {
  const VW = video.videoWidth;
  const VH = video.videoHeight;
  if (!VW || !VH) return;
  // Work at most 1280 px on the long side: phone footage is often 4K, which would make every
  // frame copy, snapshot and recording needlessly heavy. Pose detection reads the video directly.
  const k = Math.min(1, MAX_CANVAS_PX / Math.max(VW, VH));
  const W = Math.round(VW * k);
  const H = Math.round(VH * k);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
    fitStage(W, H);
  }
  ctx.drawImage(video, 0, 0, W, H);
  const cfg = settings();
  const cal = calibInfo(cfg);
  const calDraw = () => drawCalibration(ctx, state.calib, { wheelMm: cfg.wheelMm ?? '?', pxPerMm: cal.pxPerMm });
  if (!state.landmarker) return calDraw();

  let ts = performance.now();
  if (ts <= state.lastTs) ts = state.lastTs + 1;
  state.lastTs = ts;

  const res = detect(ts);
  const lms = res?.landmarks?.[0];
  if (!lms) {
    pushQuality(null);
    calDraw();
    if (state.calibStep < 0) drawMessage(ctx, t('canvas.noRider'));
    return;
  }

  let side = cfg.side;
  if (side === 'auto') {
    state.sideScore = state.sideScore * 0.9 + sideScore(lms) * 0.1;
    side = state.sideScore >= 0 ? 'left' : 'right';
  }
  if (side !== state.side) {
    state.side = side;
    state.smoother.reset();
    state.trail = [];
  }

  pushQuality(captureQuality(lms, side, W, H));
  const raw = extractPoints(lms, side, W, H);
  const pts = state.smoother.apply(raw);
  const m = computeMetrics(levelPoints(raw, cal.roll));
  const md = computeMetrics(levelPoints(pts, cal.roll));

  state.trail.push({ x: pts.ball.x, y: pts.ball.y });
  if (state.trail.length > 45) state.trail.shift();
  if (m.confidence >= 0.5) {
    state.footForwardPeak = Math.max(state.footForwardPeak * 0.995, m.footForward);
    // Keep the pedal position both in image space and relative to the hands, so the bottom bracket
    // can still be found when the camera follows a moving bike.
    state.ballBuf.push({ x: raw.ball.x, y: raw.ball.y, rx: raw.ball.x - raw.wrist.x, ry: raw.ball.y - raw.wrist.y });
    if (state.ballBuf.length > 150) state.ballBuf.shift();
  }

  // Bottom bracket: clicked during calibration, otherwise fitted live from the pedal path.
  state.frameNo += 1;
  if (!cal.bb && state.frameNo % 10 === 0) {
    const fixed = fitCircle(state.ballBuf);
    const rel = fitCircle(state.ballBuf.map((b) => ({ x: b.rx, y: b.ry })));
    const ratio = (c) => (circleUsable(c) ? c.rms / c.r : Infinity);
    const best = ratio(rel) < ratio(fixed) * 0.8 ? { ...rel, relative: true } : fixed;
    state.liveCircle = circleUsable(best) ? best : null;
  }
  const lc = state.liveCircle;
  const bb = cal.bb ?? (lc?.relative ? { x: pts.wrist.x + lc.x, y: pts.wrist.y + lc.y } : lc);
  const crankR = cal.pxPerMm ? cfg.crankMm * cal.pxPerMm : state.liveCircle?.r ?? null;
  let crank = null;
  if (bb && crankR) crank = crankAngle(rotatePt(pts.ball, -cal.roll), rotatePt(bb, -cal.roll), md.dir);
  const atThree = crank != null ? Math.abs(crank - 90) <= 8 : state.footForwardPeak > 0 && md.footForward >= state.footForwardPeak * 0.95;

  const R = liveRanges(cfg.style);
  const status = {
    torso: rate(md.torso, R.torso.range, R.torso.tol),
    shoulder: rate(md.shoulder, R.shoulder.range, R.shoulder.tol),
    elbow: rate(md.elbow, R.elbow.range, R.elbow.tol),
  };

  drawOverlay(ctx, pts, md, {
    status,
    trail: state.trail,
    kneeMax: state.phase === 'collecting' ? state.sessionKneeMax : 0,
    atThree,
    roll: cal.roll,
    bb: bb ? { x: bb.x, y: bb.y } : null,
    crankR,
  });
  calDraw();

  if (state.phase === 'collecting' && m.confidence >= 0.5) {
    const time = state.source === 'file' ? video.currentTime : performance.now() / 1000;
    state.samples.push({ pts: raw, t: time, confidence: m.confidence });
    // Keep annotated snapshots of the bottom of the stroke and the 3 o'clock position.
    if (m.knee < 178 && m.knee > state.best.knee + 0.5) {
      state.best = { knee: m.knee, img: canvas.toDataURL('image/jpeg', 0.85) };
    }
    state.sessionKneeMax = Math.max(state.sessionKneeMax, md.knee);
    countStroke(md.knee);
    const elapsed = (performance.now() - state.sessionStart) / 1000;
    if (state.strokes.n >= TARGET_STROKES && elapsed >= MIN_TEST_S) {
      endSession(true);
      return;
    }
    if (crank != null) {
      const err = Math.abs(crank - 90);
      if (err < state.front.err - 0.3) state.front = { err, ff: state.front.ff, img: canvas.toDataURL('image/jpeg', 0.85) };
    } else if (state.front.err === Infinity && m.footForward > state.front.ff + 1) {
      state.front = { err: Infinity, ff: m.footForward, img: canvas.toDataURL('image/jpeg', 0.85) };
    }
  }

  if (performance.now() - state.lastLiveUpdate > 120) {
    state.lastLiveUpdate = performance.now();
    renderLive(md, status, side, m.confidence, crank);
  }
}

/**
 * One pedal stroke = the knee angle swinging from the bent half of its range to the extended half.
 * The range comes from the last ~3 s, so it adapts to each rider; tiny ranges (not pedaling) never count.
 */
function countStroke(knee) {
  const k = state.strokes;
  k.knees.push(knee);
  if (k.knees.length > 90) k.knees.shift();
  if (k.knees.length < 20) return;
  const lo = Math.min(...k.knees);
  const hi = Math.max(...k.knees);
  if (hi - lo < 25) return;
  const mid = (hi + lo) / 2;
  const band = (hi - lo) * 0.25;
  if (knee < mid - band) k.low = true;
  else if (k.low && knee > mid + band) {
    k.low = false;
    k.n += 1;
  }
}

// ---------- Capture quality ----------
// A rolling window drives the live setup check; a session tally feeds the report.
// Thresholds were set against a real side-view phone clip (separation ≈ 0.13, size ≈ 0.37, visibility ≈ 0.98).
const QUALITY_WINDOW = 60;
const Q = { detect: 0.5, outFrac: 0.15, sep: 0.35, size: 0.3, vis: 0.7 };
const CHECKS = ['frame', 'angle', 'size', 'tracking'];
const medianOf = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

function pushQuality(q) {
  const w = (state.qualWin ??= []);
  w.push(q);
  if (w.length > QUALITY_WINDOW) w.shift();
  if (state.phase === 'collecting') (state.qualSession ??= []).push(q);
  if (performance.now() - (state.lastQualRender ?? 0) > 500) {
    state.lastQualRender = performance.now();
    renderSetupCheck();
  }
}

/** Which checks fail over a run of frames: { noRider, failed: Set, feet } or null when there is too little to judge. */
function summarizeQuality(list, minFrames = 20) {
  if (!list || list.length < minFrames) return null;
  const seen = list.filter(Boolean);
  if (seen.length / list.length < Q.detect) return { noRider: true, failed: new Set() };
  const cut = seen.filter((q) => q.outside.length);
  const failed = new Set();
  if (cut.length / seen.length > Q.outFrac) failed.add('frame');
  if (medianOf(seen.map((q) => q.sep)) > Q.sep) failed.add('angle');
  if (medianOf(seen.map((q) => q.size)) < Q.size) failed.add('size');
  if (medianOf(seen.map((q) => q.vis)) < Q.vis) failed.add('tracking');
  const feet = cut.some((q) => q.outside.some((j) => j === 'ankle' || j === 'heel' || j === 'toe'));
  return { noRider: false, failed, feet };
}

/** Live checklist under the stage: what is fine, and the one thing to move when something is not. */
function renderSetupCheck() {
  const box = $('setupCheck');
  box.hidden = !state.source || !state.landmarker;
  if (box.hidden) return;
  const s = summarizeQuality(state.qualWin);
  // A paused upload produces no frames to judge; the check appears once it plays or is analyzed.
  if (!s && state.source === 'file') {
    box.hidden = true;
    return;
  }
  let html;
  if (!s) html = `<li class="sc-wait">${t('check.checking')}</li>`;
  else if (s.noRider) html = `<li class="sc-bad">${t('check.noRider')}</li>`;
  else
    html = CHECKS.map((c) => {
      const bad = s.failed.has(c);
      const fix = bad ? `<span class="sc-fix">${t(c === 'frame' && s.feet ? 'check.fix.feet' : `check.fix.${c}`)}</span>` : '';
      return `<li class="${bad ? 'sc-bad' : 'sc-ok'}"><span class="sc-label">${t(`check.${c}`)}</span>${fix}</li>`;
    }).join('');
  // Only touch the DOM when something changed, so screen readers are not flooded.
  if ($('setupCheckList').innerHTML !== html) $('setupCheckList').innerHTML = html;
}

function renderLive(m, status, side, conf, crank) {
  state.liveHasData = true;
  const row = (label, value, cls = '') => `<dt>${label}</dt><dd class="${cls}">${value}</dd>`;
  $('live').innerHTML = [
    row(t('live.side'), t(side === 'left' ? 'side.left' : 'side.right')),
    row(t('live.facing'), t(m.dir > 0 ? 'live.facingRight' : 'live.facingLeft')),
    row(t('joint.knee'), `${Math.round(m.knee)}°`),
    row(t('joint.hip'), `${Math.round(m.hip)}°`),
    row(t('joint.torso'), `${Math.round(m.torso)}°`, status.torso),
    row(t('joint.shoulder'), `${Math.round(m.shoulder)}°`, status.shoulder),
    row(t('joint.elbow'), `${Math.round(m.elbow)}°`, status.elbow),
    row(t('live.crank'), crank != null ? `${Math.round(crank)}° (${clock(crank)})` : t('live.detecting')),
    row(t('live.confidence'), `${Math.round(conf * 100)}%`, conf >= 0.5 ? 'good' : 'bad'),
    state.phase === 'collecting' ? row(t('live.frames'), state.samples.length) : '',
  ].join('');
}

// ---------- Session ----------

function startSession() {
  if (state.phase !== 'idle' || !state.source || !state.landmarker) return;
  const cfg = settings();
  track('fit_test_start', { source: state.source, style: cfg.style });
  $('report').hidden = true;
  if (state.toast?.type === 'info') toast(null);
  if (state.source === 'camera') {
    state.phase = 'countdown';
    updateButtons();
    let n = 5;
    const cd = $('countdown');
    // A fresh node per tick restarts the pop animation.
    const show = () => (cd.innerHTML = `<span class="cd-n">${n}</span><small>${t('countdown')}</small>`);
    cd.classList.remove('go');
    cd.hidden = false;
    show();
    const iv = setInterval(() => {
      n -= 1;
      if (n > 0) return show();
      clearInterval(iv);
      cd.classList.add('go');
      cd.innerHTML = `<span class="cd-n">${t('countdown.go')}</span>`;
      state.timers.push(setTimeout(() => (cd.hidden = true), 700));
      beginCollect(cfg);
    }, 1000);
    state.timers.push(iv);
  } else {
    video.pause();
    video.currentTime = 0;
    video.playbackRate = autoRate();
    beginCollect(cfg);
    video.onended = () => endSession(true);
    video.play().catch((e) => {
      console.error(e);
      endSession(false);
      toast('err.videoFormat');
    });
  }
}

function beginCollect(cfg) {
  state.phase = 'collecting';
  state.samples = [];
  state.best = { knee: -1, img: null };
  state.front = { err: Infinity, ff: -Infinity, img: null };
  state.sessionKneeMax = 0;
  state.strokes = { n: 0, knees: [], low: false };
  state.qualSession = [];
  state.sessionStart = performance.now();
  state.recordUnsupported = false;
  // A new run never shows the previous run's video.
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingUrl = null;
  if (cfg.record) startRecorder();
  $('recBadge').hidden = false;
  const tick = () => {
    const s = (performance.now() - state.sessionStart) / 1000;
    const n = Math.min(state.strokes.n, TARGET_STROKES);
    $('recText').textContent = t('rec.strokes', { n, total: TARGET_STROKES });
    $('recBar').style.width = `${(n / TARGET_STROKES) * 100}%`;
    // Safety cap: a rider who stops pedaling still gets a report from what was captured.
    if (s >= MAX_TEST_S) endSession(true);
  };
  tick();
  state.timers.push(setInterval(tick, 250));
  updateButtons();
}

function endSession(showReport) {
  state.timers.forEach((id) => (clearInterval(id), clearTimeout(id)));
  state.timers = [];
  $('countdown').hidden = true;
  $('recBadge').hidden = true;
  const wasCollecting = state.phase === 'collecting';
  state.phase = 'idle';
  video.onended = null;
  if (state.source === 'file') {
    video.pause();
    video.playbackRate = 1;
  }
  stopRecorder();
  updateButtons();
  if (wasCollecting && showReport) {
    state.lastSamples = state.samples;
    state.reportCalib = state.calib;
    state.reportSource = state.fileUrl ?? state.stream;
    state.lastShots = { bottom: state.best.img, front: state.front.img, portrait: canvas.height > canvas.width };
    state.lastQuality = summarizeQuality(state.qualSession, 1);
    track('fit_report', { source: state.source, style: state.style });
    renderReport();
  }
}

function startRecorder() {
  const type = window.MediaRecorder
    ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
    : null;
  let rec;
  try {
    if (!window.MediaRecorder || !canvas.captureStream) throw new Error('MediaRecorder unavailable');
    rec = new MediaRecorder(canvas.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
  } catch (e) {
    console.warn(e);
    state.recordUnsupported = true;
    return;
  }
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    if (!chunks.length) return;
    if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
    const blob = new Blob(chunks, { type: rec.mimeType });
    state.recordingUrl = URL.createObjectURL(blob);
    state.recordingExt = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
    addRecordingLink();
  };
  rec.onerror = (e) => console.warn('Recording failed', e);
  rec.start(1000);
  state.recorder = rec;
}

function stopRecorder() {
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
  state.recorder = null;
}

function addRecordingLink() {
  const slot = document.querySelector('#recordingSlot');
  if (!slot) return;
  if (state.recordingUrl) {
    slot.innerHTML = `<a class="btn" href="${state.recordingUrl}" download="bike-fit-session.${state.recordingExt}">${t('rec.download')}</a>`;
  } else if (state.recordUnsupported) {
    slot.innerHTML = `<span class="muted-note">${t('info.noRecorder')}</span>`;
  }
}

// ---------- Report ----------

function fmt(m) {
  if (!Number.isFinite(m.value)) return '–';
  const v = m.value.toFixed(m.decimals);
  return m.key === 'kops' && m.value > 0 ? `+${v}${m.unit}` : `${v}${m.unit}`;
}

const statusText = (s) => (s === 'na' ? '–' : t(`status.${s}`));
const prioText = (p) => t(`prio.${Math.min(p, 3)}`);

const noColon = (s) => s.replace(/[:：]\s*$/, '');

/** A measurement laid on a strip of tape: ticks, the target band in yellow, the rider's value as the needle. */
function gaugeHtml(m) {
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
  for (let x = Math.ceil(min / step) * step; x <= max; x += step) {
    const major = Math.round(x / step) % 5 === 0;
    const p = pct(x).toFixed(2);
    ticks.push(`<line x1="${p}" x2="${p}" y1="0" y2="${major ? 11 : 6}"${major ? ' class="major"' : ''} vector-effect="non-scaling-stroke"/>`);
  }
  const left = lo == null ? 0 : pct(bandLo);
  const right = hi == null ? 100 : pct(bandHi);
  const band = `<span class="band${lo == null ? ' open-lo' : ''}${hi == null ? ' open-hi' : ''}" style="left:${left}%;width:${right - left}%"></span>`;
  const needle =
    v == null ? '' : `<span class="needle" style="left:${pct(v)}%;--from:${(left + right) / 2}%"></span>`;
  return `<div class="gauge" aria-hidden="true">
      <svg class="ticks" viewBox="0 0 100 26" preserveAspectRatio="none">${ticks.join('')}</svg>${band}${needle}
    </div>`;
}

/** Big figure, small unit: "146°", "+1.9 cm", "3.2 % of thigh". */
function gaugeValue(m) {
  if (!Number.isFinite(m.value)) return '–';
  const v = m.value.toFixed(m.decimals);
  const sign = m.key === 'kops' && m.value > 0 ? '+' : '';
  return m.unit === '°' ? `${sign}${v}°` : `${sign}${v}<small> ${m.unit}</small>`;
}

function gaugeRowHtml(m) {
  return `<li class="gauge-row s-${m.status}">
      <div class="g-name"><h4>${m.label}</h4><p class="help">${m.help}</p></div>
      <p class="g-value">${gaugeValue(m)}</p>
      <div class="g-scale">${gaugeHtml(m)}
        <p class="g-target"><span>${t('report.colTarget')} ${m.target}</span><span class="chip ${m.status}">${statusText(m.status)}</span></p>
      </div>
    </li>`;
}

/** Capture problems seen during the test, said up front because they limit how far the numbers can be trusted. */
function captureWarningHtml() {
  const failed = [...(state.lastQuality?.failed ?? [])];
  if (!failed.length) return '';
  return `<div class="capture-warn" role="note">
      <h3>${t('q.title')}</h3>
      <ul>${failed.map((c) => `<li>${t(`q.${c}`)}</li>`).join('')}</ul>
    </div>`;
}

function reportHeadHtml(res) {
  const rated = res.metrics.filter((m) => m.status !== 'na');
  const good = rated.filter((m) => m.status === 'good').length;
  const n = res.suggestions.length;
  const allGood = n === 0;
  const title = allGood ? t('verdict.allGood') : t('verdict.tweaks', { n });
  const sub = allGood ? t('verdict.allGoodSub') : t('verdict.startWith', { area: res.suggestions[0].area });
  const inRange = rated.length ? ` <span class="in-range">${t('verdict.inRange', { good, n: rated.length })}</span>` : '';
  // Riding style only changes target ranges, so it is chosen here, after the measurements, and re-scores instantly.
  const styleSwitch = `<span class="unit-switch style-switch" role="group" aria-label="${t('report.metaStyle')}">${STYLES_ORDER.map(
    (k) => `<button type="button" data-style="${k}" aria-pressed="${k === state.style}" title="${t(`style.${k}`)}">${t(`styleShort.${k}`)}</button>`,
  ).join('')}</span>`;
  const meta = [
    [t('report.metaStyle'), styleSwitch],
    [t('report.metaFrames'), res.sampleCount],
    res.cadence ? [t('report.metaCadence'), `~${Math.round(res.cadence)} rpm`] : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
  return `<header class="report-head">
      <h2>${t('report.title')}</h2>
      <div class="verdict${allGood ? ' all-good' : ''}">
        <p class="verdict-title">${title}</p>
        <p class="verdict-sub">${sub}${inRange}</p>
      </div>
      <dl class="sheet-meta">${meta}</dl>
    </header>`;
}

function renderReport({ scroll = true } = {}) {
  const cfg = settings();
  const res = analyzeSession(state.lastSamples ?? [], {
    style: cfg.style,
    heightCm: cfg.heightCm,
    crankMm: cfg.crankMm,
    calib: calibInfo(cfg, state.reportCalib ?? {}),
  });
  const el = $('report');
  el.hidden = false;
  const reveal = () => scroll && el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  if (!res.ok) {
    el.innerHTML = `<div class="report-sheet">
      <header class="report-head"><h2>${t('report.title')}</h2>
        <div class="verdict"><p class="verdict-sub"><strong>${t('report.failed')}</strong> ${res.reason}</p>
        <p class="muted-note">${t('report.usable', { n: res.sampleCount })}</p></div>
      </header></div>`;
    reveal();
    return;
  }

  const suggestions = res.suggestions.length
    ? res.suggestions
        .map(
          (s, i) => `<li class="sugg p${s.priority}">
            <span class="sugg-n" aria-hidden="true">${i + 1}</span>
            <div>
              <p class="sugg-meta"><span>${s.area}</span><span class="prio">${prioText(s.priority)}</span></p>
              <h4>${s.title}</h4>
              <p>${s.body}</p>
              <p class="action"><b>${t('report.change')}</b>${s.action}</p>
            </div>
          </li>`,
        )
        .join('')
    : `<li class="sugg"><span class="sugg-n" aria-hidden="true"></span><div>
        <h4>${t('report.allGoodTitle')}</h4><p>${t('report.allGoodBody', { style: res.styleLabel })}</p></div></li>`;

  const shots = state.lastShots ?? {};
  const snaps = [
    shots.bottom && `<figure><img src="${shots.bottom}" alt="${t('report.snapBottom')}"><figcaption>${t('report.snapBottom')}</figcaption></figure>`,
    shots.front && `<figure><img src="${shots.front}" alt="${t('report.snapFront')}"><figcaption>${t('report.snapFront')}</figcaption></figure>`,
  ]
    .filter(Boolean)
    .join('');

  el.innerHTML = `<div class="report-sheet">
    ${reportHeadHtml(res)}
    ${captureWarningHtml()}
    <div class="report-grid">
      <div class="col col-adjust">
        <section>
          <h3>${t('report.adjustments')}</h3>
          <p class="section-intro">${t('report.adjIntro')}</p>
          <ol class="suggestions">${suggestions}</ol>
        </section>
        <section>
          <h3>${t('report.fitData')}</h3>
          ${fitDataHtml(res)}
        </section>
      </div>
      <div class="col col-measure">
        <section>
          <h3>${t('report.measurements')}</h3>
          <ol class="gauges">${res.metrics.map(gaugeRowHtml).join('')}</ol>
          ${snaps ? `<div class="snaps${shots.portrait ? ' portrait' : ''}">${snaps}</div>` : ''}
        </section>
        <section>
          <h3>${t('report.chart')}</h3>
          ${res.curve ? curveChart(res.curve) : `<p class="muted-note">${t('report.chartEmpty')}</p>`}
        </section>
      </div>
    </div>
    <div class="report-actions">
      <button class="btn" id="btnPrint">${t('report.print')}</button>
      <span id="recordingSlot"></span>
    </div>
  </div>`;
  $('btnPrint').onclick = () => window.print();
  mountCharts(el);
  addRecordingLink();
  reveal();
}

function clock(deg) {
  const h = Math.round(deg / 30) % 12;
  return t('clock', { h: h === 0 ? 12 : h });
}

function fitDataHtml(res) {
  const src = res.scale.source ? SCALE_SOURCES[res.scale.source] : null;
  const item = (key, val, { signed = false } = {}) => {
    const n = Math.round(val);
    const text = !Number.isFinite(val) ? '–' : signed && n > 0 ? `+${n}` : String(n);
    return `<div><dt>${t(key)}</dt><dd>${text} <small>mm</small></dd></div>`;
  };
  const b = res.bike ?? {};
  const cells = [
    b.saddleHeight != null && item('fd.saddleHeight', b.saddleHeight),
    b.saddleSetback != null && item('fd.setback', b.saddleSetback),
    b.saddleBarDrop != null && item('fd.drop', b.saddleBarDrop),
    b.saddleBarReach != null && item('fd.sbReach', b.saddleBarReach),
    b.handStack != null && item('fd.handStack', b.handStack),
    b.handReach != null && item('fd.handReach', b.handReach),
    res.heightDeltaMm != null && item('fd.heightDelta', res.heightDeltaMm, { signed: true }),
  ].filter(Boolean);
  const scale = src ? t('fd.accuracy', { label: t(src.label), acc: t(src.accuracy) }) : t('fd.uncalibrated');
  const bbText = t(res.bbSource === 'manual' ? 'fd.bbManual' : res.bbSource === 'auto' ? 'fd.bbAuto' : 'fd.bbNone');
  return `
    <dl class="fd-source">
      <dt>${noColon(t('fd.scale'))}</dt><dd>${scale}</dd>
      <dt>${noColon(t('fd.bb'))}</dt><dd>${bbText}</dd>
      <dt>${noColon(t('fd.kops'))}</dt><dd>${t(res.kopsMethod === 'crank' ? 'fd.kopsCrank' : 'fd.kopsEst')}</dd>
    </dl>
    ${cells.length ? `<dl class="fitdata">${cells.join('')}</dl>` : `<p class="muted-note">${t('fd.empty')}</p>`}
    ${res.notes.length ? `<ul class="notes">${res.notes.map((n) => `<li>${n.text}</li>`).join('')}</ul>` : ''}`;
}

// ---------- Calibration ----------

const CALIB_STEPS = ['wheelA', 'wheelB', 'bb', 'saddle', 'bar'];

function calibInfo(cfg = settings(), c = state.calib) {
  const out = { bb: c.bb ?? null, saddle: c.saddle ?? null, bar: c.bar ?? null, pxPerMm: null, roll: 0, rollRejected: null, tooClose: false };
  if (c.wheelA && c.wheelB) {
    const d = Math.hypot(c.wheelB.x - c.wheelA.x, c.wheelB.y - c.wheelA.y);
    out.tooClose = d <= 20;
    if (cfg.wheelMm > 0 && !out.tooClose) out.pxPerMm = d / cfg.wheelMm;
    let a = Math.atan2(c.wheelB.y - c.wheelA.y, c.wheelB.x - c.wheelA.x);
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    if (Math.abs(a) <= (10 * Math.PI) / 180) out.roll = a;
    else out.rollRejected = a;
  }
  return out;
}

/** Click position in video pixels, or null when the click lands in the letterbox around the video. */
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  const sc = Math.min(r.width / canvas.width, r.height / canvas.height);
  const ox = (r.width - canvas.width * sc) / 2;
  const oy = (r.height - canvas.height * sc) / 2;
  const x = (e.clientX - r.left - ox) / sc;
  const y = (e.clientY - r.top - oy) / sc;
  if (!(x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height)) return null;
  return { x, y, v: 1 };
}

function redraw() {
  state.lastVideoTime = -1;
}

function startCalib() {
  if (!state.source || state.phase !== 'idle') return;
  if (state.source === 'file') video.pause();
  state.calibPrev = state.calib;
  state.calib = {};
  state.calibStep = 0;
  $('calibBar').hidden = false;
  $('stage').classList.add('calibrating');
  renderCalibBar();
  updateButtons();
  redraw();
  $('calibSkip').focus();
}

function renderCalibBar() {
  $('calibStepNo').textContent = t('calib.stepNo', { i: state.calibStep + 1, n: CALIB_STEPS.length });
  $('calibText').textContent = t(`calib.${CALIB_STEPS[state.calibStep]}`);
  $('calibUndo').disabled = state.calibStep === 0;
}

function advanceCalib(skipped) {
  // Skipping the first tyre edge skips the whole wheel.
  state.calibStep += skipped && state.calibStep === 0 ? 2 : 1;
  if (state.calibStep >= CALIB_STEPS.length) return finishCalib();
  renderCalibBar();
  redraw();
}

function undoCalib() {
  if (state.calibStep <= 0) return;
  state.calibStep -= 1;
  if (state.calibStep === 1 && !state.calib.wheelA) state.calibStep = 0;
  for (const k of CALIB_STEPS.slice(state.calibStep)) delete state.calib[k];
  renderCalibBar();
  redraw();
}

function closeCalib() {
  state.calibStep = -1;
  state.calibPrev = null;
  $('calibBar').hidden = true;
  $('stage').classList.remove('calibrating');
}

function finishCalib() {
  if (state.calib.wheelA && !state.calib.wheelB) delete state.calib.wheelA;
  closeCalib();
  // Calibrating the same footage after a run re-scores that run; another video's clicks never touch it.
  if (state.reportSource && state.reportSource === (state.fileUrl ?? state.stream)) state.reportCalib = state.calib;
  state.liveCircle = null;
  renderCalibStatus();
  updateButtons();
  redraw();
  rescore();
  $('btnCalib').focus();
}

/** Escape: throw away this calibration attempt and keep the previous one. */
function cancelCalib() {
  state.calib = state.calibPrev ?? {};
  closeCalib();
  renderCalibStatus();
  updateButtons();
  redraw();
  $('btnCalib').focus();
}

function renderCalibStatus() {
  const cfg = settings();
  const cal = calibInfo(cfg);
  const deg = (a) => ((a * 180) / Math.PI).toFixed(1);
  const parts = [];
  if (cal.pxPerMm) parts.push(`<span class="ok">${t('calib.ok', { px: cal.pxPerMm.toFixed(2) })}</span>`);
  else if (cal.tooClose) parts.push(`<span class="warn">${t('calib.tooClose')}</span>`);
  else if (state.calib.wheelA && !(cfg.wheelMm > 0)) parts.push(`<span class="warn">${t('calib.needCustom')}</span>`);
  else parts.push(t('calib.none'));
  if (cal.rollRejected != null) parts.push(`<span class="warn">${t('calib.rollRejected', { deg: deg(cal.rollRejected) })}</span>`);
  else if (cal.pxPerMm) parts.push(t('calib.roll', { deg: deg(cal.roll) }));
  parts.push(t(cal.bb ? 'calib.bbManual' : 'calib.bbAuto'));
  const extra = [cal.saddle && t('calib.saddleDone'), cal.bar && t('calib.barDone')].filter(Boolean).join('　');
  if (extra) parts.push(extra);
  $('calibStatus').innerHTML = parts.join('<br>');
}

// ---------- File controls ----------

function syncFileControls() {
  const dur = Number.isFinite(video.duration) ? video.duration : 0;
  $('seek').value = video.currentTime;
  $('timeText').textContent = `${video.currentTime.toFixed(1)} / ${dur.toFixed(1)} s`;
  $('btnPlay').textContent = t(video.paused ? 'btn.play' : 'btn.pause');
}

// ---------- Language ----------

function renderLangSwitch() {
  $('langSwitch').innerHTML = LANGS.map(
    (l) => `<button type="button" lang="${l.html}" data-lang="${l.code}" title="${DICTS[l.code]['lang.name']}"
      aria-pressed="${l.code === getLang()}">${l.short}</button>`,
  ).join('');
}

function renderLiveEmpty() {
  state.liveHasData = false;
  $('live').innerHTML = `<p class="muted-note live-empty">${t('live.empty')}</p>`;
}

function retranslate() {
  applyStatic();
  renderLangSwitch();
  renderStatus();
  renderToast();
  updateButtons();
  renderCalibStatus();
  if (state.calibStep >= 0) renderCalibBar();
  if (state.source === 'file') syncFileControls();
  renderSetupCheck();
  if (!$('report').hidden && state.lastSamples) renderReport({ scroll: false });
  if (!state.liveHasData) renderLiveEmpty();
  redraw();
}

// ---------- Wire up ----------

$('btnCamera').onclick = () => (state.source === 'camera' ? stopSource() : startCamera());
$('fileInput').onchange = (e) => {
  if (e.target.files[0]) track('video_upload');
  loadFile(e.target.files[0]);
  e.target.value = '';
};
// The upload control is a <label>; make it work from the keyboard like the buttons beside it.
$('btnUpload').tabIndex = 0;
$('btnUpload').setAttribute('role', 'button');
$('btnUpload').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!$('fileInput').disabled) $('fileInput').click();
  }
});
$('btnSession').onclick = () => (state.phase !== 'idle' ? endSession(false) : startSession());
$('btnPlay').onclick = () => {
  if (video.paused) {
    video.playbackRate = 1;
    video.play().catch(() => toast('err.videoFormat'));
  } else video.pause();
  syncFileControls();
};
video.addEventListener('pause', () => state.source === 'file' && syncFileControls());
$('seek').oninput = (e) => {
  video.currentTime = parseFloat(e.target.value);
};
$('toastClose').onclick = () => toast(null);

// Re-score the last session when the rider changes settings (without jumping the page to the report).
const rescore = () => state.lastSamples && state.phase === 'idle' && !$('report').hidden && renderReport({ scroll: false });
$('crank').addEventListener('change', () => (renderCalibStatus(), rescore()));
$('report').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-style]');
  if (!b || b.dataset.style === state.style) return;
  state.style = b.dataset.style;
  try { localStorage.setItem('bikefit.style', state.style); } catch {}
  rescore();
  $('report').querySelector(`button[data-style="${state.style}"]`)?.focus();
});
renderHeightUnit();
$('heightUnit').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-unit]');
  if (b && b.dataset.unit !== heightUnit) (setHeightUnit(b.dataset.unit), renderCalibStatus(), rescore());
});
for (const id of ['height', 'heightFt', 'heightIn']) {
  $(id).addEventListener('change', () => (validateHeight(), renderCalibStatus(), rescore()));
  $(id).addEventListener('input', () => $(id).getAttribute('aria-invalid') === 'true' && validateHeight());
}
for (const [id, lo, hi] of [['wheelCustom', 400, 800]]) {
  $(id).addEventListener('change', () => (validateField(id, lo, hi), renderCalibStatus(), rescore()));
  // Clear a stale error as soon as the entry becomes valid; only add errors on change, not mid-typing.
  $(id).addEventListener('input', () => $(id).getAttribute('aria-invalid') === 'true' && validateField(id, lo, hi));
}
$('wheel').addEventListener('change', () => {
  $('wheelCustomField').hidden = $('wheel').value !== 'custom';
  renderCalibStatus();
  rescore();
});
$('btnCalib').onclick = startCalib;
$('calibSkip').onclick = () => advanceCalib(true);
$('calibUndo').onclick = undoCalib;
$('calibDone').onclick = finishCalib;
canvas.addEventListener('click', (e) => {
  if (state.calibStep < 0) return;
  const p = canvasPoint(e);
  if (!p) return;
  state.calib[CALIB_STEPS[state.calibStep]] = p;
  advanceCalib(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.calibStep >= 0) cancelCalib();
});
$('langSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lang]');
  if (b && b.dataset.lang !== getLang()) setLang(b.dataset.lang);
});
onLangChange(retranslate);

// Dev-only hook for testing the report without a real video: open with ?debug
if (new URLSearchParams(location.search).has('debug')) {
  window.__bikefit = { renderSetupCheck, summarizeQuality, state, renderReport, renderCalibStatus, onSourceReady, toast, setLang, stopSource };
}

retranslate();
requestAnimationFrame(loop);
initModel();
