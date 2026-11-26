# Walkthrough Voiceover Script (`@kruschdev/pascal-plugin-plumbing`)

Timed narration script synchronized to [`assets/demo-walkthrough.mp4`](../assets/demo-walkthrough.mp4) (`72.2s` narrated runtime, `1280 x 720` H.264 @ 24fps + 48 kHz AAC voiceover via `gemini-3.8-flash-tts` voice `Charon`, 186 words, singular first-person voice).

## Clean Continuous Narration Text (TTS Input)

```text
This is Pascal Plugin Plumbing, an MIT plugin I built for Pascal Editor. Starting from a residential floorplan with a dedicated mechanical room, laundry, bath, and kitchen, one click auto-populates the gas water heater, expansion tank, PEX home-run manifold, fixtures, gravity drains, vent stacks, fuel gas, and dryer exhaust.

Switching to Low Walls and X-Ray Plumbing peels back the walls and floor slab so you can inspect orthogonal red hot and blue cold PEX home-runs, orange hot recirculation, gold fuel gas, green three-inch roof vents, and every quarter-inch-per-foot sloped ABS drain pipe dropping to the three-inch building drain out below grade.

Next, I open the interactive 3D PEX Manifold and two-by-six wet-wall cutaway right inside Pascal's split pane. Orbit the brass ball valves and three-inch PVC stack, then toggle Manifold Cover Off and Steel Enclosure Closed.

Every fixture feeds live DFU, Hunter's Curve GPM, fuel gas sizing, cross-trade Electrical power handoffs, and an exact Bones framing drill list.

Adjust labor, markup, and tax in the live priced BOM takeoff, backed by an instant IPC and IFGC audit with zero errors. Everything is MIT licensed on GitHub.
```

## Chapter-by-Chapter Beat Sheet

| Time | Chapter | Visual On Screen | Spoken Line |
|---|---|---|---|
| `0:00 - 0:15` | **1. Auto-Populate & System Layers** | Residential Floorplan (Mechanical Room, Laundry, Bath, Kitchen, 2x6 Wet Walls) -> One-Click `Auto-Populate Plumbing` (Slab-on-Grade, ABS DWV, 50 gal Gas WH, Fuel Gas, Hot Recirc, Dryer Vent) -> `DWV Vent Stack` System Layer Toggle | "This is Pascal Plugin Plumbing, an MIT plugin I built for Pascal Editor. Starting from a residential floorplan with a dedicated mechanical room, laundry, bath, and kitchen, one click auto-populates the gas water heater, expansion tank, PEX home-run manifold, fixtures, gravity drains, vent stacks, fuel gas, and dryer exhaust." |
| `0:15 - 0:34` | **2. Low Walls + X-Ray Sub-Slab 1/4"/ft Gravity DWV Orbit & 2D Plan** | `Low Walls` -> `X-Ray Plumbing` + Low-Angle 3D Orbit showing every `1/4"/ft` sloped ABS drain pipe dropping into the `3"` building drain out below grade alongside Red/Blue PEX, Orange Recirc, Gold Gas & Green 3" Vents -> `2D` Blueprint | "Switching to Low Walls and X-Ray Plumbing peels back the walls and floor slab so you can inspect orthogonal red hot and blue cold PEX home-runs, orange hot recirculation, gold fuel gas, green three-inch roof vents, and every quarter-inch-per-foot sloped ABS drain pipe dropping to the three-inch building drain out below grade." |
| `0:34 - 0:50` | **3. Interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway** | Split-pane `Inspect 3D Manifold & Wet-Wall Cutaway` -> Live 3D Orbit -> `Manifold Cover Off` -> `Steel Enclosure Closed` | "Next, I open the interactive 3D PEX Manifold and two-by-six wet-wall cutaway right inside Pascal's split pane. Orbit the brass ball valves and three-inch PVC stack, then toggle Manifold Cover Off and Steel Enclosure Closed." |
| `0:50 - 1:02` | **4. Fixture Schedule, Loads & Power, and Bones Drill List** | `Fixtures (11)` tab -> `Loads & Power` tab (`18 DFU`, `16.95 GPM`, `40 kBTU/h` Gas, 4 Electrical Power Handoffs) -> `Drill List` tab | "Every fixture feeds live DFU, Hunter's Curve GPM, fuel gas sizing, cross-trade Electrical power handoffs, and an exact Bones framing drill list." |
| `1:02 - 1:15` | **5. Live Priced BOM & IPC/IFGC Audit** | `BOM` live Labor/Markup/Tax edits -> `IPC Audit (0/0)` (`0 Errors · 0 Warnings · IPC PASS`) | "Adjust labor, markup, and tax in the live priced BOM takeoff, backed by an instant IPC and IFGC audit with zero errors. Everything is MIT licensed on GitHub." |

## Synthesizing & Muxing Voiceover with Gemini TTS

Run:

```bash
bash scripts/add-voiceover.sh --voice Charon
```

Use `--dry-run` first to validate the exact `gemini-api tts` request offline at zero cost:

```bash
bash scripts/add-voiceover.sh --dry-run
```
