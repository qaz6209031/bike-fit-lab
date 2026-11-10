# Free Bike Fit

Browser-based dynamic bike fit. Film yourself pedalling from the side (live camera or uploaded video), see joint lines and angles drawn on your body, and get a fit report with adjustment suggestions.

Everything runs locally in the browser with [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker); no video leaves the device.

## Run

```sh
python3 -m http.server 8765
# open http://localhost:8765
```

The camera needs `localhost` or HTTPS. Any static host works for deployment (Vercel, GitHub Pages, Netlify).

## How it works

| File | Role |
| --- | --- |
| `app.js` | Camera/file input, frame loop, session capture, recording, report UI |
| `metrics.js` | Picks the side facing the camera, computes per-frame angles |
| `analysis.js` | Aggregates a session into fit metrics, target ranges, suggestions |
| `draw.js` | Canvas overlay (skeleton, angle arcs, plumb line, pedal trail, crank, calibration markers) |
| `chart.js` | Knee/hip angle vs crank angle chart in the report |
| `i18n.js` | English + Traditional Chinese strings, language detection, `t()` |
| `tests/` | Simulated riders with known geometry, run in both languages, plus a dictionary key-parity check — `node tests/run.mjs` |

Session metrics:

- **Knee angle at bottom of stroke** (95th percentile): saddle height, target 140–150°. With rider height entered, the required mm change is estimated by leg geometry.
- **Knee angle at top**, **hip angle (most closed)**: crank length / bar height.
- **Torso angle**, **shoulder angle**, **elbow angle**: bar height and reach, judged by riding style.
- **Knee vs ball of foot at 3 o'clock**: saddle fore/aft.
- **Hip vertical movement**, **ankle range**: signs of a saddle that's too high.

Scale & bottom bracket (in priority order):

1. **Wheel calibration** — click the front and rear edge of the front tyre; with the tyre's outer diameter this gives px/mm and the camera roll (auto-levelled). Optionally click BB, saddle top and hand position to get saddle height, setback, saddle-to-bar drop/reach and hand stack/reach.
2. **Pedal path** — a least-squares circle fit of the ball-of-foot path gives the BB (centre) and, with the crank length, the scale (radius).
3. **Rider height** — anthropometric leg ratios (least accurate).

With a BB, knee-over-pedal is measured at the real 3 o'clock crank position, and the report plots knee/hip angle over the pedal stroke. Open with `?debug` to expose `window.__bikefit` for testing.

Ranges live in `analysis.js` (`STYLES`, `liveRanges`) and are easy to tune.

## Languages

English and Traditional Chinese. The default follows the browser language; the EN / 繁中 switch in the header overrides it and is remembered in `localStorage`. Static text uses `data-i18n` attributes in `index.html`; everything else calls `t(key, params)`. Analysis results carry stable ids (`suggestion.id`, `note.id`) so tests and logic never depend on wording. To add a language, add a dictionary to `DICTS` with the same keys — the tests fail on any missing key.
