---
name: Bike Fit Lab
description: Free in-browser dynamic bike fit from a side-view pedaling video.
colors:
  alloy: "#e9ebee"
  sheet: "#ffffff"
  sheet-inset: "#f4f5f7"
  rule: "#d5d9de"
  graphite: "#1c2126"
  spoke-muted: "#5b6570"
  tape-yellow: "#ffc21a"
  tape-yellow-edge: "#c99500"
  well-black: "#000000"
  status-good: "#17803d"
  status-close: "#b45309"
  status-bad: "#c2261d"
  calib-pink: "#db2777"
  chart-knee: "#1f5fbf"
  chart-hip: "#c2561a"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, \"PingFang TC\", \"Noto Sans TC\", sans-serif"
    fontStretch: "75%"
    fontSize: "clamp(40px, 5vw, 58px)"
    fontWeight: 800
    lineHeight: 0.98
  figure:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontStretch: "75%"
    fontSize: "28px"
    fontWeight: 800
    fontFeature: "\"tnum\""
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, \"PingFang TC\", \"Noto Sans TC\", sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, \"PingFang TC\", \"Noto Sans TC\", sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.55
  small:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  well: "4px"
  control: "6px"
  sheet: "10px"
  chip: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
  page: "24px"
components:
  button:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite}"
    borderColor: "{colors.rule}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary:
    backgroundColor: "{colors.tape-yellow}"
    textColor: "{colors.graphite}"
    borderColor: "{colors.tape-yellow-edge}"
    rounded: "{rounded.control}"
  button-disabled:
    backgroundColor: "rgba(28,33,38,0.05)"
    textColor: "#80878f"
    borderColor: "transparent"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.sheet}"
    padding: "18px"
  input:
    backgroundColor: "{colors.sheet-inset}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  gauge:
    backgroundColor: "#fbfbfa"
    bandColor: "{colors.tape-yellow}"
    rounded: "3px"
    height: "26px"
---

# Design System: Bike Fit Lab

## Overview

**North Star: "The Fitter's Tape."** A home cyclist props a phone beside the trainer and wants what a bike fitter gives them: angles measured against a target, and the one wrench turn to make first. The interface borrows the fitter's tools rather than the look of a software dashboard: a brushed-alloy workbench, white fit sheets, graphite ink, and tape-measure yellow wherever something is being measured. The video lives in a true-black well so the overlay reads at a distance.

The memorable element is the **tape gauge**: every measurement in the report is laid on a strip of tape with ticks, its target band in yellow and the rider's value as a needle in its status colour. Everything around it stays quiet.

This replaced an earlier dark navy + mint direction (November 2026) that read as a generic AI-generated tool: near-black with one acid accent, identical rounded cards, ALL-CAPS card labels, middle-dot meta strings and monospace data labels.

## Colors

- **Alloy** (#e9ebee) is the page; cool, never cream.
- **Sheet** (#ffffff) carries setup and the report. Sheets sit on alloy with no shadow; the value step is the edge.
- **Graphite** (#1c2126) is all primary text and the selected state of toggles. **Spoke** (#5b6570) is secondary text (5:1 on alloy).
- **Tape yellow** (#ffc21a) is a fill, never a text colour. It marks measurement: the primary action, gauge target bands, the chart's target band, the "Change" tag on each adjustment, the demo rider's angle tag.
- **Status**: good #17803d, borderline #b45309, adjust #c2261d. Always paired with words (chip text, value colour plus label).
- **Calibration pink** (#db2777) belongs only to calibration: the calibration bar outline and the canvas click markers.
- **Well black** (#000) is the stage. Not a tinted near-black.

### Named Rules
- **Yellow Means Measured.** If it is not a target, a measurement or the one primary action, it is not yellow.
- **Pink Is Calibration.** Unchanged from the previous system.

## Typography

One family, two widths. **Archivo** (Google Fonts, variable `wdth` 62–125, `wght` 100–900) at normal width for reading, and at 75% width for figures and display: the verdict, the gauge values, live angles, fit-data numbers, step numbers, the wordmark. Condensed figures look stamped on a tool and keep large numbers compact. Chinese text falls back to PingFang TC / Noto Sans TC.

- Display (verdict): 40–58px, 800, condensed, line-height 0.98.
- Figures: 23–36px, 700–800, condensed, tabular.
- Section headings: 17–19px, 700, sentence case.
- Body: 15.5px / 1.55. Small and help text: 13–13.5px in Spoke.
- Running text is capped near 66ch.

### Named Rules
- **No All-Caps Labels.** Headings are sentence case at real heading weight; no tracked-out eyebrow labels.
- **No Monospace Costume.** Data uses tabular figures in Archivo, not a monospace face.

## Layout

Workbench: the stage column (video well, toolbar, file controls) on the left; a 330px side column with the setup sheet (two groups, "Rider & test" and "Bike & calibration", divided by a hairline), the live readout and the filming tips. Under 960px everything stacks; under 560px the toolbar becomes a 2×3 grid of 44px buttons with the primary action bottom-right.

The report is a single **fit sheet**: header (verdict, in-range count, and a small definition list of riding style / frames / cadence), then two columns: adjustments and fit data on the left, gauges, snapshots and the crank chart on the right. Left-aligned throughout.

## Elevation & Depth

Flat. Depth comes from value steps (alloy → sheet → inset) and hairline rules, never shadows.

## Shapes

Radius encodes role: video well and snapshots 4px (an instrument), controls 6px, sheets 10px, chips full pill. The gauge strip is 3px.

## Components

### Buttons
White with a rule border; primary is tape yellow with a darker yellow edge and graphite text. Ghost buttons are transparent with a stronger outline. Disabled is a flat 5% graphite slab with no border, so it never reads like a ghost button.

### Tape gauge (signature)
26px strip, off-white, ticks hanging from the top edge (major every five steps), target band in 55% tape yellow with darker yellow ends (open-ended targets lose that end), needle 3px in status colour. The needle sweeps in from the band centre once when the report appears (0.8s ease-out, staggered 40ms per row); reduced motion shows it in place.

### Adjustments
A numbered list, because the order is the instruction. Each step has the bike area and a priority chip, a title, the reason, and the action led by a yellow "Change" tag.

### Live readout
Condensed 23px figures in status colour, readable from the saddle.

### Demo rider (empty stage)
Unchanged pedaling figure in overlay colours; its knee-angle tag is tape yellow with graphite text.

## Do's and Don'ts

### Do:
- Keep the stage pure black and the rest of the UI light.
- Put new measurements on a tape gauge rather than inventing another visual.
- Write sentence-case headings and plain-verb buttons.

### Don't:
- Use yellow as text or as decoration.
- Add shadows, gradient washes or cards inside sheets.
- Join metadata with middle dots; use a small definition list.
- Reintroduce ALL-CAPS labels, monospace data or `→` prefixes.
