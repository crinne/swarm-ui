# Swarm GCS UI Redesign

**Date:** 2026-06-06  
**Status:** Approved

## Goal

Improve the visual quality of the swarm GCS UI to match the polished dark-theme aesthetic of the vaca-studio reference app. No new backend features — purely visual upgrades plus a per-drone altitude sparkline.

## Scope

- Dark map style
- Improved drone cards (battery bar, heading arrow, mode badge)
- Per-drone altitude sparkline
- No new dependencies

## Out of Scope

- Formation display
- Mission planning
- Any backend or API changes

---

## Section 1: Map & Overall Layout

Switch the MapTiler style URL from `outdoor-v2` to `dataviz-dark` (same API key). The flex layout is unchanged — map fills the left, sidebar is fixed `w-72` on the right.

Color palette:
- App background: `#0f1117`
- Sidebar background: `#0f1117`
- Card background: `#1a1d27`
- Card border (default): `#2a2d3a`
- Card border (selected): `#3b82f6` (blue-500)
- Accent: `#3b82f6` (blue-500)

## Section 2: Drone Cards

Each card is upgraded with three visual elements:

**Mode badge**  
Moves to a pill badge right-aligned in the card header. Contains a colored dot + text. Green dot = armed modes (`GUIDED_ARMED`, `AUTO_ARMED`), gray dot = other. Font: `text-xs font-mono`.

**Heading arrow**  
A 20×20px inline SVG compass: outer circle + an arrow that rotates to `drone.heading` degrees. Sits inline next to the heading value.

**Battery bar**  
A full-width thin (`h-1.5`) progress bar below the stats row. Color:
- `>50%` → green (`#22c55e`)
- `20–50%` → yellow (`#eab308`)
- `<20%` → red (`#ef4444`)

Selected state: `border-blue-500` with a subtle `shadow-[0_0_8px_rgba(59,130,246,0.4)]` glow.

## Section 3: Altitude Sparkline

**Data:** A `useRef<Map<number, number[]>>` holds a rolling buffer of up to 60 `z` samples per drone, updated on every telemetry tick.

**Rendering:** An inline `<svg>` element, `width="100%" height="32"`, at the bottom of each card.
- Normalizes buffer values to SVG coordinate space (min/max scaling, with 2px padding top/bottom)
- `<polyline>` stroke: `#3b82f6`, `stroke-width="1.5"`, `fill="none"`
- Filled area: `<polygon>` with same points extended to baseline, `fill="#3b82f6"`, `fillOpacity="0.15"`
- Fewer than 2 points: renders nothing (no broken line)

## Implementation Notes

- All changes are in `src/App.tsx` — single file, no new components needed
- Altitude buffer lives in a `useRef` alongside the existing `markers` ref
- No new npm packages required
- Map style URL change: one line in the `maplibregl.Map` constructor
