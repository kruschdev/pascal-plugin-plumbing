# Contributing to `@kruschdev/pascal-plugin-plumbing`

1. Install dependencies with `bun install`.
2. Run the full verification gate before opening a PR:
   ```bash
   bun run check
   ```
3. Maintain all 5 entry boundary gates (`bun run check:render`):
   - `./render` must never import `@pascal-app/editor` or `next`.
   - `./cad` must never import `react`, `react-dom`, `@pascal-app/editor`, or `next`.
   - `./agent-tools` must remain pure Zod-only (`E-016`).
   - `./agent-operations` must remain headless-pure.
   - `./ipc` must remain pure framework-free TypeScript.
4. Allocate fresh `createPlumbingMaterialPool()` instances per CAD build call so Pascal geometry disposal never breaks sibling meshes.
5. Regenerate `.glb` assets with `bun run export:cad` whenever adding or updating a CAD builder.
