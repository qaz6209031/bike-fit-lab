---
name: Free Bike Fit
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
    fontStretch: "66%"
    fontSize: "clamp(40px, 5.6vw, 80px)"
    fontWeight: 850
    lineHeight: 0.94
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
  control: "4px"
  sheet: "4px"
  chip: "3px"
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
    borderColor: "{colors.graphite}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary:
    backgroundColor: "{colors.tape-yellow}"
    textColor: "{colors.graphite}"
    borderColor: "{colors.graphite}"
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

# Design System: Free Bike Fit

## Overview

**North Star: "Tape on the bench."** A home cyclist props a phone beside the trainer and wants what a bike fitter gives them: angles measured against a target, and the one wrench turn to make first. The page is a workbench: brushed alloy ruled in graphite, a true-black video well, one white fit sheet, one graphite block. The tape measure is the structure, not a decoration.

The signature is the **tape**: a ruled line carrying the five "How it works" stations, and a tape gauge for every measurement in the report. (A live knee-angle tape under the headline was tried and removed at the owner's request.) Everything around it stays quiet.

History: a dark navy + mint direction was replaced in November 2026 by "The Fitter's Tape" (white rounded sheets on alloy). The second pass (also November 2026) removed the remaining card-on-grey look: side-column cards became ruled spec sections, "How it works" became five stations on a ruled line, the story became a graphite block, and display type grew and narrowed.

## Colors

- **Alloy** (#e9ebee) is the page; cool, never cream.
- **Sheet** (#ffffff) is the fit report and the inputs. Setup, live angles and "How it works" sit straight on alloy under 2px graphite rules; they are not sheets.
- **Graphite** (#1c2126) is all primary text, control outlines, section rules, the selected state of toggles, and the background of the single "Why I built this" block. **Spoke** (#5b6570) is secondary text (5:1 on alloy).
- **Tape yellow** (#ffc21a) is a fill, never a text colour. It marks measurement: the primary action, gauge target bands, the chart's target band, the "Change" tag on each adjustment, the demo rider's angle tag.
- **Status**: good #17803d, borderline #b45309, adjust #c2261d. Always paired with words (chip text, value colour plus label).
- **Calibration pink** (#db2777) belongs only to calibration: the calibration bar outline and the canvas click markers.
- **Well black** (#000) is the stage. Not a tinted near-black.

### Named Rules
- **Yellow Means Measured.** If it is not a target, a measurement or the one primary action, it is not yellow.
- **Pink Is Calibration.** Unchanged from the previous system.

## Typography

One family, two widths. **Archivo** (Google Fonts, variable `wdth` 62–125, `wght` 100–900) at normal width for reading, and at 75% width for figures and display: the verdict, the gauge values, live angles, fit-data numbers, step numbers, the wordmark. Condensed figures look stamped on a tool and keep large numbers compact. Chinese text falls back to PingFang TC / Noto Sans TC.

- Display (page headline, verdict, section headings): 36–84px, 850, width 66%, line-height 0.94. Chinese display text is set smaller with normal line-height.
- Figures: 23–36px, 700–800, condensed, tabular.
- Side-column and report headings: 23–26px, 800, condensed, sentence case. Step numerals: 48–64px.
- Body: 15.5px / 1.55. Small and help text: 13–13.5px in Spoke.
- Running text is capped near 62ch, except the intro lede and footer, which use the full width at the owner's request.

### Named Rules
- **No All-Caps Labels.** Headings are sentence case at real heading weight; no tracked-out eyebrow labels.
- **No Monospace Costume.** Data uses tabular figures in Archivo, not a monospace face.

## Layout

Top bar on a full-width graphite rule, then the headline and the lede. Workbench below: the stage column (video well, toolbar, file controls) on the left; a 330px side column of ruled sections (setup, live readout, filming tips). On desktop the empty well is a wide band (drawing left, instruction right) so the buttons stay on screen. Under 960px everything stacks; under 560px the toolbar becomes a 2×2 grid of 44px buttons with the primary action bottom-right.

The report is a single **fit sheet** with a 6px graphite top edge: header (verdict, in-range count, riding style / frames / cadence), then two columns: adjustments and fit data on the left, gauges, snapshots and the crank chart on the right.

"How it works" is five columns on one ruled line (a list under 1100px). "Why I built this" is the one graphite block, story left, scope list right with a tape-yellow tick per item. Left-aligned throughout.

### Print / PDF
The report prints as a document, not a screenshot: a letterhead (wordmark, site address, date), one column in reading order (adjustments, fit data, measurements, snapshots, chart), point-sized type, gauge rows always on one line, no page breaks inside a step, a gauge row or the chart, and the safety footer at the end. The riding-style switch prints as just the chosen style.

## Elevation & Depth

Flat. Depth comes from value steps (alloy → sheet → inset) and hairline rules, never shadows.

## Shapes

Tooling radii only: video well, controls, sheets and the graphite block 4px; gauge strips, chips and tags 3px. No pills.

## Components

### Buttons
White with a 1.5px graphite outline; they fill graphite on hover and move 1px when pressed (not under reduced motion). Primary is tape yellow with the same graphite outline. Ghost buttons are transparent with a grey outline that turns graphite on hover. Disabled is a flat 5% graphite slab with no border.

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
- Add shadows, gradient washes, cards inside sheets, or white rounded cards on the alloy.
- Add a second dark block; the story is the only one.
- Join metadata with middle dots; use a small definition list.
- Reintroduce ALL-CAPS labels, monospace data or `→` prefixes.
