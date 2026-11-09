---
name: Bike Fit Lab
description: Free in-browser dynamic bike fit from a side-view pedaling video.
colors:
  studio-black: "#0b0f17"
  bench-navy: "#121826"
  bench-navy-raised: "#1a2233"
  hairline-slate: "#263049"
  chalk-text: "#e6eaf2"
  slate-muted: "#8b95ab"
  fit-mint: "#34d399"
  fit-mint-ink: "#052e1f"
  fit-mint-hover: "#5ee0b0"
  status-amber: "#fbbf24"
  status-coral: "#f87171"
  calib-pink: "#f472b6"
  stage-black: "#05070c"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "\"tnum\""
rounded:
  field: "8px"
  control: "10px"
  card: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  page: "24px"
components:
  button:
    backgroundColor: "{colors.bench-navy-raised}"
    textColor: "{colors.chalk-text}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary:
    backgroundColor: "{colors.fit-mint}"
    textColor: "{colors.fit-mint-ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.fit-mint-hover}"
  button-small:
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.bench-navy}"
    rounded: "{rounded.card}"
    padding: "16px"
  input:
    backgroundColor: "{colors.bench-navy-raised}"
    textColor: "{colors.chalk-text}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
  pill:
    backgroundColor: "{colors.bench-navy-raised}"
    textColor: "{colors.slate-muted}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  chip-good:
    textColor: "{colors.fit-mint}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: Bike Fit Lab

## Overview

**Creative North Star: "The Fit Studio Bench"**

Bike Fit Lab looks like the measuring bench in a professional fit studio after the lights go down: a near-black room where the only bright things are the rider's skeleton lines, the joint angles and the one action that matters next. The interface steps back so the data can step forward. Chrome is dark navy, separated by hairline borders rather than shadows, and colour is spent almost entirely on meaning: mint for in-range and for the primary action, amber for close, coral for out of range.

It is a tool, not a showcase. Density is comfortable rather than airy, numbers are tabular, and every label is short enough to read from a bike saddle a few metres away. The components are precise and restrained: thin borders, no ornament, one filled button per screen.

**Key Characteristics:**
- Dark, single-theme studio surface (no light theme on screen; print switches to white).
- Hairline-bordered flat cards on tonal navy layers; no drop shadows.
- Colour is semantic first: mint / amber / coral status, plus a reserved pink for calibration.
- System sans for everything, monospace with tabular numerals for measured values.
- The video stage is the hero; side panel and report are quiet supporting surfaces.

## Colors

A cool, low-chroma navy ramp carries the surface; saturated colour appears only where it means something.

### Primary
- **Fit Mint** (fit-mint): the primary action button, the brand mark stroke, focus rings, the "→" action marker, in-range readings and the target band on the curve chart. Also the "good" status colour, which is intentional: mint means "this is right / do this".
- **Fit Mint Ink** (fit-mint-ink): text on mint-filled buttons.

### Secondary
- **Status Amber** (status-amber): "close to range" readings, chips and priority-2 suggestions; the knee-over-pedal plumb line on the canvas uses a sibling yellow.
- **Status Coral** (status-coral): out-of-range readings, priority-1 suggestions, error toasts, field errors and the recording dot.

### Tertiary
- **Calibration Pink** (calib-pink): reserved for the calibration flow only (bar border, step number, canvas click markers). It never appears outside calibration.

### Neutral
- **Studio Black** (studio-black): page background.
- **Stage Black** (stage-black): the video stage behind the canvas, a step darker than the page so footage reads as a window.
- **Bench Navy** (bench-navy): cards, suggestion cards, calibration bar, toasts.
- **Bench Navy Raised** (bench-navy-raised): buttons, inputs, pills, fit-data tiles: anything sitting on a card.
- **Hairline Slate** (hairline-slate): every border and table rule.
- **Chalk Text** (chalk-text): primary text.
- **Slate Muted** (slate-muted): labels, hints, captions, chart axes.

### Named Rules
**The Meaning-Only Colour Rule.** Saturated colour appears only as status, the primary action, or calibration. Decorative colour is not allowed.

**The Pink Is Calibration Rule.** Calibration pink is reserved for the calibration flow so the rider always knows they are placing reference points.

## Typography

**Display Font:** system UI sans (ui-sans-serif, system-ui, -apple-system), with PingFang TC / Noto Sans TC / Microsoft JhengHei for Traditional Chinese
**Body Font:** same stack
**Label/Mono Font:** ui-monospace / SFMono-Regular / Menlo for measured values

**Character:** Native and unremarkable on purpose; the system face disappears so the numbers and the video carry the page. The CJK fallbacks keep the bilingual UI in one consistent voice.

### Hierarchy
- **Display** (700, 24px, 1.2): the report title only.
- **Headline** (600, 20px, 1.2): the brand wordmark and the empty-stage prompt.
- **Title** (700, 17px, 1.2): suggestion card headings.
- **Body** (400, 15px, 1.6): running text; help copy steps down to 12.5–14px in muted slate.
- **Label** (600, 12–13px, 0.06–0.08em tracking, uppercase): card headings, table headers, suggestion area labels.
- **Mono** (13px, tabular numerals): targets and time readouts. Large readings (fit-data values, 20px/700) use the sans with `tabular-nums`.

### Named Rules
**The Tabular Numbers Rule.** Every measured number uses tabular numerals so values do not jitter while the live view updates.

**The 16px Field Rule.** Form controls render text at 16px so iOS Safari never zooms on focus.

## Layout

The app is a two-column workbench: a fluid stage column (video, then calibration bar, toolbar, file controls, toast) beside a fixed 320px settings panel, inside a 1500px max-width container with 20px gaps and 24px page padding. At 960px and below the panel drops under the stage and padding tightens to 16px.

The report appears below the workbench. On wide screens (1101px+) it is two columns, measurements left and adjustments right. At 1100px and below it collapses to one column with adjustments first, because those are what the rider acts on. At 560px and below the metrics table becomes stacked two-line rows that keep the target visible.

Spacing runs on a 4px base, mostly 8 / 10 / 12 / 16 / 20px. Toolbars wrap, and the primary-action group stays right-aligned when it does.

## Elevation & Depth

The system is flat. Depth comes from tonal layering (studio black → bench navy → bench navy raised) plus a 1px hairline-slate border on every container. There are no box-shadows. The only translucent layers are overlays on the video stage: the countdown scrim and the recording badge, both stage black at 45–80% opacity.

### Named Rules
**The Hairline, Not Shadow Rule.** Separate surfaces with a tonal step and a 1px border, never a drop shadow.

## Shapes

Corners are gently rounded and scale with the size of the element: 8px on inputs, 10px on buttons, tiles, toasts and snapshots, 12px on cards and the stage, and fully round pills for status chips, the model-status pill, the language switch and the recording badge. Lines in charts and on the canvas use round caps.

## Components

### Buttons
Precise and restrained: one filled button per context, everything else quiet.
- **Shape:** gently rounded (10px).
- **Default:** bench navy raised fill, chalk text, hairline border, 600 weight, 9px × 16px.
- **Primary:** fit mint fill with mint-ink text; lightens to mint hover. Used once per toolbar ("Start fit test").
- **Ghost:** transparent fill, same border; for secondary session actions (Save image, Stop, Dismiss).
- **Small:** 6px × 12px, 14px text; calibration and toast actions.
- **Hover / Focus:** the border and fill step lighter over 150ms; a 2px fit-mint focus ring with a 2px offset. Disabled is 45% opacity.

### Chips
- **Style:** pill, 12px/700, the status colour as text on an 18% tint of the same colour.
- **State:** good / close / bad only. Always paired with a text label, never colour alone.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** bench navy; nested tiles use bench navy raised with 10px corners.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px hairline slate.
- **Internal Padding:** 16px (suggestion cards 14 × 16px).
- **Heading:** uppercase muted label, 13px, 0.08em tracking.

### Inputs / Fields
- **Style:** bench navy raised fill, hairline border, 8px corners, 16px text, 8 × 10px padding. The label sits above in 13px muted slate, with the hint on its own line below.
- **Focus:** the global 2px fit-mint focus ring.
- **Error:** the border turns coral (`aria-invalid`) and a 13px coral message appears below.

### Navigation
A single top bar: the brand mark (mint outline bicycle) and wordmark on the left; the model-status pill and the EN / 繁中 segmented language switch on the right. The switch is a pill track whose active segment fills with bench navy raised.

### Video Stage (signature)
The 16:9 stage-black window with 12px corners holds the canvas overlay. Joint lines are colour-coded by limb (leg blue, arm violet, torso orange, foot teal), and angle tags are pill-shaped dark labels. Tags and lines scale with the displayed size, so they stay legible from about 15px on desktop to 12px on phones. The countdown, the recording badge and the empty-state prompt overlay the stage; the calibration bar sits below it, never on top.

### Demo Rider (signature)
The empty stage shows a side-view stick rider that pedals at about 80 rpm. It uses the overlay's limb colours and a mint knee-angle tag that updates live, so first-time visitors see what the app will draw on them. The bike frame is hairline-dim slate so the body lines read first. It is hidden when the stage is narrower than 520px, runs only while visible, and shows a still 3 o'clock frame under reduced motion.

### Verdict (signature)
A coaching headline opens the report: "Dialed in." in mint when every measure is in range, otherwise "N things to tweak." in chalk, with "Start with: {area}" and a strip of status dots (one per rated measure, in table order) labelled "x of y measures in range". This is the only celebratory moment in the app. The camera countdown pops each number and ends on a mint "Go!".

### Suggestion Card (signature)
A bench navy card with an uppercase area label and a priority marker (coral P1, amber P2, mint P3), a 17px title, a muted explanation, and a bold action line led by a mint "→".

## Do's and Don'ts

### Do:
- **Do** keep the page dark (studio black #0b0f17) and let the video stage be the brightest, most saturated area.
- **Do** reserve fit mint for the single primary action, focus, and "in range".
- **Do** pair every status colour with a text label or chip text.
- **Do** use tabular numerals for every measured value.
- **Do** separate surfaces with a tonal step and a 1px hairline-slate border.

### Don't:
- **Don't** add drop shadows, gradients or glassmorphism to cards or buttons.
- **Don't** use calibration pink outside the calibration flow.
- **Don't** put more than one mint-filled button in the same toolbar or card.
- **Don't** overlay controls on the video stage where they could cover the bike or rider.
- **Don't** introduce web fonts; the system stack is what keeps the Traditional Chinese and English text consistent.
