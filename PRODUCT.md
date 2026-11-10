# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Amateur cyclists worldwide who want to fit their own bike without paying for an in-person fit. They ride on an indoor trainer at home, film themselves from the side with a phone or laptop camera, and adjust saddle, bars and cranks themselves based on the result. The English-speaking market is the primary audience; Traditional Chinese is one supported language, not the lead one.

## Product Purpose

Free Bike Fit turns a short side-view video of someone pedalling into a dynamic bike fit: it draws joint lines and angles on the rider, measures the fit over a whole pedal stroke, and tells them what to adjust, in what order, and by roughly how many millimetres. Success is a rider who can make a correct, safe adjustment on their own and verify it with a follow-up session.

## Positioning

Free. The core fit analysis costs nothing, in a category where the main online competitor (MyVeloFit) and app-based tools charge for detailed reports and recommendations.

## Operating Context

- Rider sets the bike on an indoor trainer, levels it, and places the camera side-on at hip height, 2.5–4 m away, landscape, with the whole body and both wheels in frame.
- Input is either a live camera session (countdown, then 10/20/30 s of capture) or an uploaded side-view video analysed at reduced playback speed.
- Optional calibration: the rider clicks the front tyre's front and rear edges (plus optionally bottom bracket, saddle top and hand position) to give the analysis a real-world scale and correct camera roll.
- Typical loop: film → read report → change one thing by a few millimetres → ride → film again.

## Capabilities and Constraints

- **Pure front end, no back end — a long-term constraint.** Static site; all pose detection and analysis run in the visitor's browser. Any persistence (history, before/after comparison) must live in the visitor's own browser. No accounts, cloud storage or server-side sharing.
- Pose detection: Google MediaPipe Pose Landmarker (pretrained, run in-browser, loaded from CDN). Everything after keypoint detection is rule-based geometry and statistics, no LLM.
- Measures: knee angle at bottom and top of stroke, most-closed hip angle, torso angle, shoulder and elbow angles, knee-over-pedal at 3 o'clock, hip vertical movement, ankle range, cadence; knee/hip angle across the crank cycle; bike coordinates (saddle height, setback, saddle-to-bar drop/reach, hand stack/reach) when calibrated.
- Scale sources in priority order: wheel calibration → pedal-circle fit with known crank length → rider height.
- Riding styles: comfort/commuter, endurance road/gravel, race/aggressive road.
- Outputs: annotated live overlay, fit report with prioritised suggestions, snapshots, annotated video recording, print/PDF.
- Only 2D, single-side analysis today; front-view knee tracking, TT/MTB styles, symptom questionnaire, flexibility assessment and session history are open roadmap items, not shipped.
- **Language:** English and Traditional Chinese, switchable in the header. The default follows the browser's language (any Chinese locale → Traditional Chinese, otherwise English) and a manual choice is remembered in that browser. All copy lives in `i18n.js`; a new language is a new dictionary with the same keys.

## Evidence on Hand

- Analysis is validated only against simulated riders with known geometry (`tests/run.mjs`). It has **not** been validated on real rider footage or against a goniometer or in-person fit. Do not claim accuracy figures, "matches professional fits", or similar until that evidence exists.
- No users, testimonials, partners, press or usage numbers exist. Do not fabricate them.

## Product Principles

1. **Free means the whole fit.** The analysis, the report and the adjustment suggestions are never paywalled.
2. **Say why, not just what.** Every suggestion names the measurement and range it comes from, so a rider can judge it and a fitter could check it.
3. **One safe change at a time.** Order suggestions by priority (saddle height first), keep steps small (≤ 5 mm), and tell riders to stop if anything hurts.
4. **Be honest about precision.** Always show where the scale came from and how accurate it is; prefer telling the rider to re-film over presenting a confident wrong number.
5. **Nothing leaves the browser.** A consequence of the no-back-end constraint that future features must respect.

## Accessibility & Inclusion

No product-specific standard has been set beyond the web baseline. *Inferred, not confirmed:* riders watch the live view from the bike, a few metres from the screen, so live feedback likely needs to stay legible at that distance.
