# 42-Model Clean-Room MIT 3D Plumbing CAD Catalog

All 42 procedural Three.js CAD parts in `src/cad/catalog.ts` export cleanly to binary `.glb` via `bun run export:cad`:

- **Water Heaters & Mechanical Equipment (12)**: 50 gal Electric Tank WH, 50 gal Gas Tank WH w/ Flue, Tankless Condensing Gas WH, Hybrid Heat Pump WH, 2 gal Thermal Expansion Tank, Main Shutoff + PRV + Gauge, Whole-House Water Softener, Sump Pump Basin, Sealed Sewage Ejector Basin, Hot Water Recirc Pump, Natural Gas Utility Meter, Mainline Backwater Valve.
- **PEX & Fuel-Gas Manifolds (4)**: 12-Port PEX Home-Run Manifold (Open), 24-Port PEX Manifold w/ Enclosure, Type L Copper Header, 8-Port CSST Gas Manifold.
- **Residential & Commercial Fixtures (14)**: Elongated Water Closet, Vanity Lavatory, Kitchen Sink, Alcove Bathtub, Walk-In Shower, Tub/Shower Combo, Dishwasher Rough-In, Washer Outlet Box & Standpipe, Laundry Sink, Bar Sink, Floor Drain, Frost-Proof Hose Bibb, Commercial Urinal, Commercial Mop Basin.
- **DWV Fittings & Cleanouts (7)**: Solvent-Weld P-Trap, Sanitary Tee, 45° Wye/Combo, Long-Sweep 90°, Two-Way Cleanout Tee, Roof Vent Flashing Boot, Air Admittance Valve (AAV).
- **Supply & Fuel-Gas Valves (4)**: Full-Port Brass Ball Valve, Quarter-Turn Angle Stop, Thermostatic Mixing Valve, Gas Drip Leg & Shutoff.
- **Cutaway Assemblies (1)**: 2x6 Wet-Wall PEX Manifold & 3" PVC Stack Cutaway (plus swept `buildPipeRunCad` with 3D stud bore collars and steel nail plates).
