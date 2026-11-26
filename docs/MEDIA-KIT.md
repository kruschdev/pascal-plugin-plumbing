# Media Kit and Launch Package (`@kruschdev/pascal-plugin-plumbing`)

Ready-to-share narrated walkthrough video, high-resolution screenshots, 3D CAD contact sheet, OpenGraph hero banner, and launch copy for [`@kruschdev/pascal-plugin-plumbing`](https://github.com/kruschdev/pascal-plugin-plumbing).

## Included Visual Assets

| Asset | Resolution / Format | Best Use |
|---|---|---|
| [`assets/social-preview.png`](../assets/social-preview.png) | `1280 x 640` PNG | GitHub Social Preview, OpenGraph card, LinkedIn/X link banner |
| [`assets/demo-walkthrough.mp4`](../assets/demo-walkthrough.mp4) | `1280 x 720` H.264 MP4 (`72.2s`, narrated AAC + `+faststart`) | X video post, LinkedIn native video, YouTube, GitHub Release |
| [`assets/demo-walkthrough.gif`](../assets/demo-walkthrough.gif) | `640px` palette-optimized GIF | README preview, Reddit, Discord, Slack |
| [`assets/demo-3d-plumbing-routing.png`](../assets/demo-3d-plumbing-routing.png) | `1440 x 810` PNG | Live Pascal Editor X-Ray Plumbing view showing Mechanical Room core, Red/Blue PEX home-runs, Orange Recirc, Gold Gas, Green 3" vents, and uniform `1/4"/ft` sloped ABS DWV drains dropping to the 3" building drain out below grade |
| [`assets/demo-manifold-cutaway.png`](../assets/demo-manifold-cutaway.png) | `1920 x 760` PNG | 4-panel 3D PEX Manifold & 2x6 Wet-Wall Cutaway showcase (Wet-Wall & 3" Stack Cutaway, Zoom Ball Valves & Nail Plates, 24-Port Steel Enclosure Closed, 8-Port CSST Gas Manifold) |
| [`assets/demo-plumbing-schedule.png`](../assets/demo-plumbing-schedule.png) | `1440 x 810` PNG | Live split-pane 3D house + populated Plumbing Engineering Schedule (`IPC-2021`) |
| [`assets/cad-material-catalog.png`](../assets/cad-material-catalog.png) | `1680 x 2560` PNG | Complete 47-model clean-room MIT Plumbing CAD catalog contact sheet (5x10 studio grid) |
| [`docs/WALKTHROUGH-SCRIPT.md`](./WALKTHROUGH-SCRIPT.md) | Markdown Beat Sheet | Timed ~60-second chapter-by-chapter narration script & TTS input text |
| [`scripts/add-voiceover.sh`](../scripts/add-voiceover.sh) | Bash (`gemini-api tts` + `ffmpeg`) | One-command Gemini TTS synthesis (`gemini-3.8-flash-tts`) and AAC muxing into `assets/demo-walkthrough-narrated.mp4` |

## Project Facts (Quick Reference)

- **Repository**: `https://github.com/kruschdev/pascal-plugin-plumbing`
- **Package Name**: `@kruschdev/pascal-plugin-plumbing` (`v0.1.0`)
- **License**: MIT (clean-room procedural Three.js geometry, zero third-party meshes)
- **Host Compatibility**: Pascal Editor Plugin API v1 (`E-014`, `E-016`, `E-017`), zero upstream core changes required
- **3D CAD Library**: 47 exported binary `.glb` models + 47 studio thumbnails across 6 categories (Water Heaters & Mechanical Equipment, PEX & Fuel-Gas Manifolds, Residential & Commercial Fixtures, DWV Fittings & Cleanouts, Supply & Fuel-Gas Valves, Pipe Runs & Cutaway Assemblies)
- **Live Editor Placement**: 33 live placeable kinds (`12` mechanical equipment units, `3` manifolds, `18` residential and commercial fixtures) with 2D floorplan symbols, snapping ports, IPC/UPC/IFGC/IRC auditing, and 2026 supply-house BOM pricing
- **Verification**: 47/47 deterministic IPC/UPC/IFGC/IRC, Bones framing penetration, Priority #1 `structural:*` interop, cross-trade `electrical:*` / `hvac:*` coordination, CAD, and boundary tests (`693` assertions), `tsc --noEmit` clean, 5/5 entrypoint boundary gates, compiled Node 22 ESM + Bun `dist/` build

## Ready-to-Post Copy

### Pascal GitHub Discussions (`pascalorg/editor` -> `Show and tell`)

**Category**: `Show and tell` (`https://github.com/pascalorg/editor/discussions/categories/show-and-tell`)

**Title**: `MIT Residential & Light-Commercial IPC/UPC/IFGC Plumbing Plugin (@kruschdev/pascal-plugin-plumbing): Gravity DWV, PEX Manifolds, Bones Drill Lists, Electrical Power Handoff, and 47 .glb CAD Models`

**Attachments to drag-and-drop into the GitHub Discussion editor**:
1. `assets/demo-walkthrough.mp4` (renders an inline native video player in GitHub Discussions)
2. `assets/demo-manifold-cutaway.png`

**Body**:

I built a standalone, MIT-licensed **Residential and Light-Commercial IPC / UPC / IFGC / IRC Plumbing** plugin for Pascal Editor (`@kruschdev/pascal-plugin-plumbing`) implementing Pascal's Plugin API v1 (`E-014`, `E-016`, `E-017`) with zero upstream core changes.

It pairs directly with `@pascal-app/plugin-bones` and [`@kruschdev/pascal-plugin-electrical`](https://github.com/kruschdev/pascal-plugin-electrical) while keeping zero hard dependencies on either package. Plumbing reads `bones:framing` (`16"`/`24"` OC studs and wall thickness) and `bones:service` (`water-heater`, `water-entry`, `sewer-exit`), honors Priority #1 `structural:assembly` `2x6` wet-wall framing, detours around `structural:beam` and `structural:column` members, and publishes standardized `electricalDemand` payloads so Electrical automatically allocates dedicated breakers and 3D power runs for water heaters, sump/sewage pumps, dishwashers, disposals, washers, and bidets.

**What it ships**

- **One-click IPC/UPC auto-populate and Bones anchor ingestion**: Scans rooms, placed fixtures, and optional Bones service anchors to lay out mechanical equipment (electric/gas/tankless/HPWH water heaters, expansion tank, PRV, softener, sump/sewage basins), PEX home-run manifolds or trunk-and-branch copper/PEX, frost-proof hose bibbs with anti-siphon vacuum breakers, gravity-sloped DWV drains, 3" roof vent stacks, dry re-vents (`>= 6"` above flood-level rim), optional IFGC fuel gas, and 4" rigid aluminum dryer vents (`IRC M1502.4`).
- **Priority #2 MEP right-of-way and monotonic gravity DWV routing**: Enforces downward gravity pitch (`1/4"/ft` for `<= 2-1/2"`, `1/8"/ft` minimum for `>= 3"`), prohibits horizontal sanitary tees (`IPC Table 706.3`), checks trap-arm distances (`IPC Table 909.1`), detours around structural beams/columns, and enforces `NEC 110.26(E)` dedicated electrical space above panels and transformers.
- **Bones 16"/24" OC framing drill list and 3D bore visualization**: Computes the exact 3D `(x, y, z)` crossing of every wall stud, sole plate, and double top plate, renders 3D bore-hole collars and galvanized steel nail plates (`IRC R602.6` / `IPC 305.6`) directly on pipe runs, and generates a live **Drill List** with hole-saw diameters and `% of stud depth`.
- **Interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway plus 6-tab split-pane schedule**: Inspect Red Hot and Blue Cold PEX-A quarter-turn ball valves, galvanized nail plates, and the adjacent 3" PVC stack inside a 2x6 wet wall (`2x6 Wet-Wall & 3" Stack Cutaway`, `Manifold Cover Off`, `Steel Enclosure Closed`), alongside live Fixture Schedules, DFU / Modified Hunter's Curve GPM / Hazen-Williams / IFGC gas load calcs, Cross-Trade Electrical Power Coordination, IPC/IFGC Audit, Framing Drill List, and contractor-priced BOM takeoffs (CSV export).
- **47 clean-room MIT `.glb` CAD models and 8 pure Zod agent tools**: Covers water heaters, manifolds, 18 residential/commercial fixtures, DWV fittings, valves, hangers, and the 2x6 wet-wall cutaway across 6 strict boundary entrypoints (`.`, `./render`, `./cad`, `./ipc`, `./agent-tools`, `./agent-operations`).

> Drafting and engineering aid, not stamped engineering. Always verify calculations, pipe sizing, and local AHJ amendments with a licensed plumbing engineer or master plumber before construction.

**Try it**

```bash
git clone https://github.com/kruschdev/pascal-plugin-plumbing.git
cd pascal-plugin-plumbing
bun install && bun run check
```

```ts
import { extendPluginDiscovery } from '@pascal-app/core'
import { registerEditorHostPanel, registerEditorHostView } from '@pascal-app/editor'
import {
  plumbingHostPanel,
  plumbingPlugin,
  plumbingScheduleView,
} from '@kruschdev/pascal-plugin-plumbing'

extendPluginDiscovery(async () => [plumbingPlugin])
registerEditorHostPanel(plumbingHostPanel)
registerEditorHostView(plumbingScheduleView)
```

Repo (MIT): https://github.com/kruschdev/pascal-plugin-plumbing

**What I would love feedback on**

1. If you test it on a multi-level Pascal project alongside `plugin-bones` and `pascal-plugin-electrical`, let me know how the wet-wall stack selection and cross-trade electrical handoff behave on your floorplan.
2. Any feedback on IPC vs UPC edge cases, Hunter's Curve residential/commercial sizing, or IFC/OpenBIM plumbing pipe export conventions would be super helpful.

### Pascal Discord (`https://discord.gg/XRKsDcpqgS`)

Attach `assets/demo-walkthrough.mp4` or `assets/demo-walkthrough.gif`:

Hey everyone! I just released an open-source MIT Residential & Light-Commercial IPC/UPC/IFGC Plumbing plugin for Pascal Editor (`@kruschdev/pascal-plugin-plumbing`, built on Plugin API v1 with zero core changes).

One click auto-populates fixtures, water heaters, a PEX home-run manifold, monotonic 1/4"/ft gravity-sloped DWV drains, 3" roof vent stacks, optional IFGC fuel gas, and dryer exhaust. It reads `@pascal-app/plugin-bones` framing to render 3D stud bore collars and IRC R602.6 steel nail plates with a live Drill List, hands off powered plumbing loads automatically to `pascal-plugin-electrical`, opens an interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway inside Pascal's split pane, and ships 47 clean-room MIT `.glb` CAD models plus 8 pure Zod agent tools.

GitHub (MIT): https://github.com/kruschdev/pascal-plugin-plumbing
Discussion thread: <paste pascalorg/editor Show and tell URL once posted>

Would love feedback from anyone testing it on real floorplans!

### OSArch Community (`https://community.osarch.org`)

**Title**: `Open-source MIT IPC/UPC/IFGC Plumbing Plugin + 47 Procedural Three.js .glb CAD Models for Pascal Editor`

**Body**:

I recently built and published `@kruschdev/pascal-plugin-plumbing`, a standalone MIT-licensed residential and light-commercial plumbing engineering plugin for Pascal Editor (open-source browser-first 3D AECO editor built on React Three Fiber and WebGPU).

A few technical details that may be useful to OpenBIM / AECO builders here:

- **Zero-dependency engineering core (`./ipc`)**: Pure TypeScript implementations of IPC 2021 / UPC 2021 DFU drain and vent stack sizing (`IPC Tables 709.1, 710.1, 906.1, 909.1`), Modified Hunter's Curve WSFU-to-GPM demand, Hazen-Williams head loss and velocity limits (`<= 5 ft/s` hot copper, `<= 8 ft/s` cold/PEX), IFGC Table 402.4 longest-length fuel-gas sizing, IRC M1502.4 dryer exhaust effective length, IRC R602.6 framing bore checks, and `NEC 110.26(E)` dedicated electrical space auditing.
- **Gravity-sloped 3D MEP routing & framing penetration solver**: Holds Priority #2 MEP right-of-way (`Structural -> Plumbing -> HVAC -> Electrical`), enforces monotonic downward DWV pitch (`1/4"/ft` and `1/8"/ft`), detours around structural beams and columns, and computes exact wall stud, sole-plate, and top-plate drill coordinates with 3D bore collars and nail plates.
- **Cross-trade electrical power handoff**: Every powered plumbing unit publishes a standardized JSON `electricalDemand` payload so an electrical plugin in the same scene can automatically allocate dedicated breakers and route 3D power runs back to each unit.
- **47 clean-room MIT `.glb` plumbing CAD models (`./cad`)**: Generated purely in Three.js with no third-party meshes, covering electric/gas/tankless/HPWH water heaters, PEX/copper/CSST manifolds, 18 residential/commercial fixtures, DWV fittings, valves, pipe hangers, and an interactive 2x6 wet-wall cutaway assembly.
- **8 pure Zod agent tools (`./agent-tools`)**: Executable from MCP servers or headless workflows with zero React or Three.js dependencies.

Repo & walkthrough video: https://github.com/kruschdev/pascal-plugin-plumbing

Drafting and engineering aid only, not stamped engineering. I would appreciate any critique on IPC/UPC edge cases, DWV vent-stack sizing, or IFC / OpenBIM piping schema alignment.

### X (Main Video Post)

I built an open-source MIT plumbing engineering plugin for @pascal (Pascal Editor) that turns any floorplan into a sloped, IPC-checked 3D plumbing model in one click.

It lays out fixtures, water heaters, and PEX home-run manifolds, routes monotonic quarter-inch-per-foot gravity DWV drains and 3-inch roof vent stacks, computes exact 16-inch OC Bones framing drill lists with 3D stud bore collars and steel nail plates, hands off powered loads directly to Electrical, and opens a live 3D 2x6 wet-wall manifold cutaway inside Pascal's split pane.

Includes 47 clean-room MIT .glb CAD models, DFU and Hunter's Curve GPM load calcs, IFGC fuel gas, contractor-priced BOM takeoffs, and 8 pure Zod agent tools.

Repo (MIT): https://github.com/kruschdev/pascal-plugin-plumbing

### LinkedIn Post

I just released an open-source MIT IPC/UPC/IFGC plumbing authoring plugin for Pascal Editor (`@kruschdev/pascal-plugin-plumbing`).

Starting from a standard architectural floorplan, one click scans rooms, placed fixtures, and optional `@pascal-app/plugin-bones` framing and service anchors to lay out mechanical equipment, a PEX home-run manifold (or trunk-and-branch copper/PEX), gravity-sloped DWV drains, 3" roof vent stacks, fuel gas, and dryer exhaust.

A few engineering details I focused on:
- Priority #2 MEP right-of-way (`Structural -> Plumbing -> HVAC -> Electrical`) with monotonic downward gravity pitch (`1/4"/ft` for `<= 2-1/2"`, `1/8"/ft` for `>= 3"`), structural beam/column detours, and `NEC 110.26(E)` dedicated electrical space auditing.
- Exact `16"` / `24"` OC framing penetration solving synced to `plugin-bones` (honoring `2x6` wet walls), rendering 3D bore collars and `IRC R602.6` galvanized steel nail plates directly on pipe runs alongside a live Framing Drill List.
- Automatic cross-trade Electrical power handoff: every powered plumbing unit (water heaters, sump/sewage pumps, recirc pump, softener, dishwasher, disposal, washer, bidet) emits a standardized `electricalDemand` payload so `@kruschdev/pascal-plugin-electrical` allocates dedicated breakers and 3D power runs automatically.
- An interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway (`2x6 Wet-Wall & 3" Stack Cutaway`, `Manifold Cover Off`, `Steel Enclosure Closed`) plus 47 clean-room MIT `.glb` CAD models, DFU/WSFU/Hunter's Curve GPM/IFGC load calculators, and contractor-priced BOM takeoffs.

Code, all 47 `.glb` assets, and 8 pure Zod agent tools are open source under MIT: https://github.com/kruschdev/pascal-plugin-plumbing

### Hacker News (`Show HN`)

**Title**: `Show HN: Open-source IPC/UPC plumbing CAD, gravity DWV routing, and 3D wet-wall cutaway plugin for Pascal Editor`

**Body**:
I built an open-source MIT plumbing plugin (`@kruschdev/pascal-plugin-plumbing`) for Pascal Editor that implements Pascal's Plugin API v1 (`E-014` / `E-016` / `E-017`) as a standalone external package with zero core merges.

Given a Pascal floorplan, it runs a deterministic IPC/UPC/IFGC/IRC layout and sizing engine, routes monotonic gravity-sloped 3D DWV drains (`1/4"/ft` and `1/8"/ft`), 3" roof vent stacks, Red/Blue PEX home-run supply lines, fuel gas, and dryer exhaust, computes exact `16"`/`24"` OC stud and plate drill coordinates with 3D bore collars and `IRC R602.6` nail plates, publishes standardized `electricalDemand` payloads for automatic cross-trade breaker allocation, and opens an interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway inside Pascal's split pane.

It also ships 47 clean-room procedural Three.js `.glb` plumbing CAD models plus 8 pure Zod agent tools with zero React or Three.js dependencies.

Repo: https://github.com/kruschdev/pascal-plugin-plumbing

## Regenerating the Full Media Kit

```bash
bun run export:cad
bun scripts/render-cad-thumbnails.ts
bun scripts/render-manifold-cutaway-closeup.ts
PASCAL_EDITOR_URL=http://127.0.0.1:3210/project/<id> bun run render:walkthrough
bun scripts/render-social-preview.ts
bash scripts/add-voiceover.sh --voice Charon
```
