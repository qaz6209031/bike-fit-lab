import {
  sideScore, extractPoints, computeMetrics, PointSmoother, levelPoints, rotatePt, crankAngle, fitCircle, circleUsable,
} from './metrics.js';
import { analyzeSession, liveRanges, rate, SCALE_SOURCES } from './analysis.js';
import { drawOverlay, drawMessage, drawCalibration } from './draw.js';
import { curveChart, mountCharts } from './chart.js';
import { mountRiderDemo } from './rider-demo.js';
import { t, getLang, setLang, onLangChange, applyStatic, LANGS, DICTS } from './i18n.js';

// Loaded on demand so a CDN failure can be reported and retried instead of breaking the whole page.
const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const SLOW_MODEL_MS = 15000;
const LONG_VIDEO_S = 90;

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
};

/** A number field's value when it is inside [lo, hi], else null (an invalid entry is ignored, never guessed at). */
function numIn(id, lo, hi) {
  const raw = $(id).value.trim();
  const v = parseFloat(raw);
  return raw !== '' && v >= lo && v <= hi ? v : null;
}

const settings = () => ({
  style: $('style').value,
  heightCm: numIn('height', 120, 220),
  side: $('side').value,
  duration: parseInt($('duration').value, 10),
  record: $('recordVideo').checked,
  speed: parseFloat($('speed').value),
  wheelMm: $('wheel').value === 'custom' ? numIn('wheelCustom', 400, 800) : parseFloat($('wheel').value),
  crankMm: parseFloat($('crank').value),
});

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
      toast('info.longVideo', { min: (dur / 60).toFixed(1), est: Math.ceil(dur / settings().speed / 60) }, { type: 'info' });
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
  riderDemo.start();
  $('fileControls').hidden = true;
  renderLiveEmpty();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateButtons();
}

function updateButtons() {
  const busy = state.phase !== 'idle';
  $('btnSession').disabled = !state.source || !state.landmarker || busy || state.calibStep >= 0;
  $('btnSession').textContent = t(state.source === 'file' ? 'btn.analyzeVideo' : 'btn.startFit');
  $('btnSnapshot').disabled = !state.source;
  $('btnStop').disabled = !state.source;
  $('btnStop').textContent = t(busy ? 'btn.finishNow' : 'btn.stop');
  $('btnCamera').disabled = busy || state.cameraStarting;
  $('btnCalib').disabled = !state.source || busy || state.calibStep >= 0;
}

// ---------- Frame loop ----------

function loop() {
  requestAnimationFrame(loop);
  if (!state.source || video.readyState < 2) return;
  const time = video.currentTime;
  if (time === state.lastVideoTime) return;
  if (state.source === 'file' && Math.abs(time - state.lastVideoTime) > 0.5) {
    state.smoother.reset();
    state.trail = [];
  }
  state.lastVideoTime = time;
  processFrame();
  if (state.source === 'file') syncFileControls();
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

function processFrame() {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
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

  const raw = extractPoints(lms, side, W, H);
  const pts = state.smoother.apply(raw);
  const m = computeMetrics(levelPoints(raw, cal.roll));
  const md = computeMetrics(levelPoints(pts, cal.roll));

  state.trail.push({ x: pts.ball.x, y: pts.ball.y });
  if (state.trail.length > 45) state.trail.shift();
  if (m.confidence >= 0.5) {
    state.footForwardPeak = Math.max(state.footForwardPeak * 0.995, m.footForward);
    state.ballBuf.push({ x: raw.ball.x, y: raw.ball.y });
    if (state.ballBuf.length > 150) state.ballBuf.shift();
  }

  // Bottom bracket: clicked during calibration, otherwise fitted live from the pedal path.
  state.frameNo += 1;
  if (!cal.bb && state.frameNo % 10 === 0) {
    const c = fitCircle(state.ballBuf);
    state.liveCircle = circleUsable(c) ? c : null;
  }
  const bb = cal.bb ?? state.liveCircle;
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
      state.timers.push(setTimeout(() => endSession(true), cfg.duration * 1000));
    }, 1000);
    state.timers.push(iv);
  } else {
    video.pause();
    video.currentTime = 0;
    video.playbackRate = cfg.speed;
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
  state.sessionStart = performance.now();
  state.recordUnsupported = false;
  if (cfg.record) startRecorder();
  $('recBadge').hidden = false;
  const tick = () => {
    const s = (performance.now() - state.sessionStart) / 1000;
    $('recText').textContent =
      state.source === 'camera'
        ? t('rec.remaining', { s: Math.max(0, cfg.duration - s).toFixed(0) })
        : t('rec.elapsed', { s: s.toFixed(0) });
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
    state.lastShots = { bottom: state.best.img, front: state.front.img };
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

// One-line verdict above the report: a status strip (one dot per rated measure) plus a headline in the
// app's coaching voice. The all-in-range case gets the only celebratory treatment in the app.
function verdictHtml(res) {
  const rated = res.metrics.filter((m) => m.status !== 'na');
  const good = rated.filter((m) => m.status === 'good').length;
  const n = res.suggestions.length;
  const allGood = n === 0;
  const dots = rated.map((m) => `<i class="${m.status}"></i>`).join('');
  const title = allGood ? t('verdict.allGood') : t('verdict.tweaks', { n });
  const sub = allGood ? t('verdict.allGoodSub') : t('verdict.startWith', { area: res.suggestions[0].area });
  return `<div class="verdict${allGood ? ' all-good' : ''}">
      <p class="verdict-title">${title}</p>
      <p class="verdict-sub">${sub}</p>
      ${rated.length ? `<p class="verdict-strip"><span class="dots" aria-hidden="true">${dots}</span>${t('verdict.inRange', { good, n: rated.length })}</p>` : ''}
    </div>`;
}

function renderReport({ scroll = true } = {}) {
  const cfg = settings();
  const res = analyzeSession(state.lastSamples ?? [], {
    style: cfg.style,
    heightCm: cfg.heightCm,
    crankMm: cfg.crankMm,
    calib: calibInfo(cfg),
  });
  const el = $('report');
  el.hidden = false;
  const reveal = () => scroll && el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  if (!res.ok) {
    el.innerHTML = `<div class="report-head"><h2>${t('report.title')}</h2></div>
      <div class="card"><p><strong>${t('report.failed')}</strong> ${res.reason}</p>
      <p class="mono">${t('report.usable', { n: res.sampleCount })}</p></div>`;
    reveal();
    return;
  }

  const rows = res.metrics
    .map(
      (m) => `<tr>
        <td>${m.label}<span class="help">${m.help}</span></td>
        <td class="num">${fmt(m)}</td>
        <td class="mono" data-label="${t('report.colTarget')}">${m.target}</td>
        <td><span class="chip ${m.status}">${statusText(m.status)}</span></td>
      </tr>`,
    )
    .join('');

  const suggestions = res.suggestions.length
    ? res.suggestions
        .map(
          (s) => `<article class="sugg p${s.priority}">
            <div class="area"><span class="prio">${prioText(s.priority)}</span>· ${s.area}</div>
            <h3>${s.title}</h3>
            <p>${s.body}</p>
            <p class="action">${s.action}</p>
          </article>`,
        )
        .join('')
    : `<article class="sugg"><div class="area">${t('report.allGoodArea')}</div><h3>${t('report.allGoodTitle')}</h3>
        <p>${t('report.allGoodBody', { style: res.styleLabel })}</p></article>`;

  const shots = state.lastShots ?? {};
  const snaps = [
    shots.bottom && `<figure><img src="${shots.bottom}" alt="${t('report.snapBottom')}"><figcaption>${t('report.snapBottom')}</figcaption></figure>`,
    shots.front && `<figure><img src="${shots.front}" alt="${t('report.snapFront')}"><figcaption>${t('report.snapFront')}</figcaption></figure>`,
  ]
    .filter(Boolean)
    .join('');

  el.innerHTML = `
    <div class="report-head">
      <h2>${t('report.title')}</h2>
      <span class="meta">${t('report.meta', { style: res.styleLabel, n: res.sampleCount, rpm: res.cadence ? Math.round(res.cadence) : null })}</span>
    </div>
    ${verdictHtml(res)}
    <div class="report-grid">
      <div class="col col-adjust">
        <div class="card"><h2>${t('report.adjustments')}</h2>
          <p class="muted-note">${t('report.adjIntro')}</p>
        </div>
        <div class="suggestions">${suggestions}</div>
        <div class="card">
          <h2>${t('report.fitData')}</h2>
          ${fitDataHtml(res)}
        </div>
      </div>
      <div class="col col-measure">
        <div class="card">
          <h2>${t('report.measurements')}</h2>
          <table class="metrics-table">
            <thead><tr><th>${t('report.colMeasure')}</th><th>${t('report.colYours')}</th><th>${t('report.colTarget')}</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${snaps ? `<div class="snaps">${snaps}</div>` : ''}
        </div>
        <div class="card">
          <h2>${t('report.chart')}</h2>
          ${res.curve ? curveChart(res.curve) : `<p class="muted-note">${t('report.chartEmpty')}</p>`}
        </div>
      </div>
    </div>
    <div class="report-actions">
      <button class="btn" id="btnPrint">${t('report.print')}</button>
      <span id="recordingSlot"></span>
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
    <p class="fd-source">${t('fd.scale')}<strong>${scale}</strong>
      · ${t('fd.bb')}${bbText}
      · ${t('fd.kops')}${t(res.kopsMethod === 'crank' ? 'fd.kopsCrank' : 'fd.kopsEst')}</p>
    ${cells.length ? `<dl class="fitdata">${cells.join('')}</dl>` : `<p class="muted-note">${t('fd.empty')}</p>`}
    ${res.notes.length ? `<ul class="notes">${res.notes.map((n) => `<li>${n.text}</li>`).join('')}</ul>` : ''}`;
}

// ---------- Calibration ----------

const CALIB_STEPS = ['wheelA', 'wheelB', 'bb', 'saddle', 'bar'];

function calibInfo(cfg = settings()) {
  const c = state.calib;
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
  if (!$('report').hidden && state.lastSamples) renderReport({ scroll: false });
  if (!state.liveHasData) renderLiveEmpty();
  redraw();
}

// ---------- Wire up ----------

$('btnCamera').onclick = startCamera;
$('fileInput').onchange = (e) => {
  loadFile(e.target.files[0]);
  e.target.value = '';
};
// The upload control is a <label>; make it work from the keyboard like the buttons beside it.
$('btnUpload').tabIndex = 0;
$('btnUpload').setAttribute('role', 'button');
$('btnUpload').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('fileInput').click();
  }
});
$('btnSession').onclick = startSession;
$('btnStop').onclick = () => (state.phase !== 'idle' ? endSession(true) : stopSource());
$('btnSnapshot').onclick = () => {
  if (!canvas.width || !canvas.height) return toast('err.snapshot');
  canvas.toBlob((blob) => {
    if (!blob) return toast('err.snapshot');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bike-fit-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
};
$('btnPlay').onclick = () => {
  if (video.paused) {
    video.playbackRate = settings().speed;
    video.play().catch(() => toast('err.videoFormat'));
  } else video.pause();
  syncFileControls();
};
video.addEventListener('pause', () => state.source === 'file' && syncFileControls());
$('seek').oninput = (e) => {
  video.currentTime = parseFloat(e.target.value);
};
$('speed').onchange = () => {
  video.playbackRate = settings().speed;
};
$('toastClose').onclick = () => toast(null);

// Re-score the last session when the rider changes settings (without jumping the page to the report).
const rescore = () => state.lastSamples && state.phase === 'idle' && renderReport({ scroll: false });
for (const id of ['style', 'crank']) $(id).addEventListener('change', () => (renderCalibStatus(), rescore()));
for (const [id, lo, hi] of [['height', 120, 220], ['wheelCustom', 400, 800]]) {
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
  window.__bikefit = { state, renderReport, renderCalibStatus, onSourceReady, toast, setLang, stopSource };
}

retranslate();
requestAnimationFrame(loop);
initModel();
