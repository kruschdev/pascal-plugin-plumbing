# IPC / UPC / IFGC / IRC Engineering Reference

Implemented deterministic tables and rules in `src/ipc/*`:

- **IPC Table 709.1 / UPC Table 702.1**: Drainage Fixture Units (DFU) across 18 residential and commercial fixture kinds.
- **IPC Table 710.1(1) & 710.1(2)**: Building drain, sewer, horizontal branch, and vertical stack sizing (`>= 3"` enforced once a water closet is upstream; `4"` for `3+` WCs on a horizontal branch).
- **IPC Table 704.1**: Gravity drainage pitch (`>= 1/4"/ft` for `<= 2-1/2"`, `>= 1/8"/ft` for `>= 3"`, zero uphill segments).
- **IPC Table 706.3**: Prohibits sanitary tees on horizontal drainage turns (requires 45° wye/combo or long-sweep 90°).
- **IPC 708.1**: Stack-base and building-drain cleanouts and `<= 100 ft` cleanout spacing.
- **IPC 903.1 / Table 906.1 / Table 909.1 / 905.5**: `3"` minimum main vent stack through roof, vent sizing, max trap-arm distances (`1-1/4": 5 ft`, `1-1/2": 6 ft`, `2": 8 ft`, `3": 12 ft`, `4": 16 ft`), and horizontal dry vent tie-in `>= 6"` above fixture flood-level rim.
- **IPC Table E103.3(2) & E103.3(3)**: WSFU to Modified Hunter's Curve Peak GPM (flush-tank and flushometer) plus Hazen-Williams head loss and velocity limits (`<= 5 ft/s` hot copper, `<= 8 ft/s` cold copper / PEX / CPVC).
- **IPC 504.6 / 504.7 / 607.3**: Water heater T&P relief discharge pipe, safety drain pan, and closed-system thermal expansion tank sizing.
- **IPC 608.15.4.2**: Anti-siphon vacuum breaker protection on exterior hose bibbs.
- **IRC R602.6 / IPC 305.6**: `2x6` wet-wall cavity checks for `3"`/`4"` DWV pipes, `40%`/`60%` wall stud boring limits, sole-plate and double top-plate penetration checks, hole-saw sizing, and galvanized nail-plate requirements. (Scope note: `computePipeFramingPenetrations` models wall studs, sole plates, and double top plates; `IRC R502.8` floor-joist boring and `stair`/`window`/`door` 3D obstacle extraction are not modeled.)
- **IFGC Table 402.4(2) / 402.4(15) / 408.4 / 409.5**: Longest-length natural gas sizing for Schedule 40 Black Iron and CSST, sediment trap (drip leg), and appliance shutoff within `6 ft`.
- **IRC M1502.4**: Smooth rigid `4"` metal dryer exhaust duct capped at `35 ft` effective length (`-5 ft` per 90° elbow, `-2.5 ft` per 45° elbow).
- **NEC 110.26(E)**: Dedicated Electrical Space keep-out above `electrical:panel` and `electrical:transformer` nodes.
