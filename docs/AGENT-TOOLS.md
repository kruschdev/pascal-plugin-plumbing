# Agent Tools Reference (`E-016`)

`plumbingAgentTools` (`@kruschdev/pascal-plugin-plumbing/agent-tools`) exports 8 pure Zod tool contracts paired with headless scene operations in `plumbingAgentOperations` (`@kruschdev/pascal-plugin-plumbing/agent-operations`):

1. `plumbing_place_equipment`: Place water heaters, expansion tanks, PRVs, softeners, sump/sewage pumps, recirc pumps, gas meters, or backwater valves with automatic `electricalDemand` metadata.
2. `plumbing_place_manifold`: Place PEX home-run, copper trunk, or CSST fuel-gas manifolds.
3. `plumbing_place_fixture`: Place any of 18 residential or commercial fixtures with DFU/WSFU rough-in data.
4. `plumbing_route_pipe`: Route 3D gravity DWV, vent, supply, fuel-gas, or dryer-vent pipe runs with automatic obstacle detours and framing penetration drill reporting.
5. `plumbing_autopopulate`: One-click full building plumbing layout honoring placed Pascal items and `@pascal-app/plugin-bones` anchors.
6. `plumbing_calculate_loads`: Calculate DFU, WSFU/GPM, water heater sizing, fuel gas loads, and electrical power coordination.
7. `plumbing_generate_schedule`: Export fixture schedule CSV, pipe summaries, framing drill list, and priced BOM CSV.
8. `plumbing_audit_ipc`: Audit the scene against IPC/UPC/IFGC/IRC, Bones framing bore limits, NEC 110.26(E), and unwired electrical loads.
