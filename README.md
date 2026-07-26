# cs2.ts

A TypeScript SDK and CLI for turning a description of a Counter-Strike 2 map into a
real, playable map — no Hammer session required to build it, though Hammer opens the
result unchanged if you want to look.

## What this is

You describe a map as a graph of rooms: boxes with sizes, connected to each other by
corridors, doorways and ramps. cs2.ts derives every room's world position from that
graph, cuts the openings between adjacent rooms, builds Source 2 brush geometry, and
writes the result as a `.vmap`. The mental model, end to end:

```
TypeScript → .vmap → resourcecompiler → .vpk
```

Your module builds the room graph and exports it; the CLI loads that module, runs the
solver and mesh builder, and writes the `.vmap`. From there, Valve's own
`resourcecompiler.exe` — the same one Hammer calls — turns it into a `.vpk` that CS2
can load.

Three things about the output are worth stating plainly, because they aren't what
you'd guess from a "map compiler":

- The `.vmap` is **plain text** — keyvalues2-encoded DMX, opening with a header line
  like `<!-- dmx encoding keyvalues2 4 format vmap 40 -->` — not a binary blob. Valve's
  own `dmxconvert.exe` round-trips it byte-identically, and Source 2 Hammer opens it
  unchanged, as a completely ordinary map.
- `cs2ts preview` compiles it in about 3 seconds. A full `cs2ts build` — with vis, nav
  and a baked lightmap — takes longer; see [CLI](#cli) for the example's numbers.
- The output is **byte-deterministic**: the same map module produces the exact same
  `.vmap` bytes every time, in a separate process, run by anyone. Diff it, check it
  into version control, and expect silence when nothing changed.

v1's scope is greyboxing: rooms, corridors, ramps, doorways, spawns and bomb sites,
built from untextured dev-material brushes. That scope, and the fact that the map
module is a plain data structure rather than a sequence of Hammer clicks, is also what
makes it something an LLM agent can author directly — the target audience is as much a
coding agent as it is a person who has never opened Hammer.

## Install

```
bun add @cs2-ts/sdk
bun add -d @cs2-ts/cli
```

`@cs2-ts/sdk` is what your map module imports from — `CS2Map`, `Direction`, and the
rest. `@cs2-ts/cli` is the `cs2ts` command; it only runs at build time, so it belongs
in `devDependencies`.

## A complete example

This is `examples/de_example.ts` in full:

```ts
import { CS2Map, Direction, Transition, Align, Team, Bombsite } from '@cs2-ts/sdk'

const map = new CS2Map('de_example')

// anchor — the only room the map itself places
const tSpawn = map.room({ name: 'tSpawn', size: [1024, 768, 192] })

// placement edges — create and position in one call
const mid   = tSpawn.room({ name: 'mid',   size: [1536, 1024, 256] },
                          { direction: Direction.North, width: 192, length: 512 })
const aSite = mid.room({ name: 'aSite', size: [1024, 1024, 256] },
                       { direction: Direction.East, width: 256, length: 384,
                         rise: 128, via: Transition.Ramp })

// a second route from spawn to the site, closing a loop
const conn = tSpawn.room({ name: 'connector', size: [1024, 768, 192] },
                         { direction: Direction.East, width: 192, length: 256 })

// height difference is derived, not authored — the ramp follows from it
map.connect(conn, aSite, { width: 192 })

tSpawn.spawns(Team.T, {
  count: 10,
  align: Align.Bottom,
  at: [0, 192, 0],           // nudge the grid clear of the south wall
  facing: Direction.North,
})
aSite.bombsite(Bombsite.A, { size: [512, 512, 128] })
mid.entity('light_omni', { at: [0, 0, 128] })

export default map
```

`tSpawn` is the anchor — the one room the map places directly, at the origin. Every
other room is created through a parent (`tSpawn.room(...)`, `mid.room(...)`), with a
`Connection` that fixes its position relative to that parent. `map.connect()` is
different: it joins two rooms that are *already* placed, without moving either —
that's what closes the loop between `connector` and `aSite` here.

Solving that graph gives every room and corridor a concrete position. This is the
layout `de_example` derives, and it doubles as the reference fixture for the solver's
own tests:

```
room       x                y                floor z
tSpawn     [-512,  512]     [-384,  384]     0        (anchor)
mid        [-768,  768]     [ 896, 1920]     0
aSite      [1152, 2176]     [ 896, 1920]     128
connector  [ 768, 1792]     [-384,  384]     0

corridor            x                y             note
tSpawn → mid        [ -96,   96]     [ 384,  896]
mid → aSite         [ 768, 1152]     [1280, 1536]  ramp 0 → 128 over 384
tSpawn → connector  [ 512,  768]     [ -96,   96]
connector → aSite   [1376, 1568]     [ 384,  896]  ramp 0 → 128 over 512, derived
```

Note that `connector → aSite` isn't authored anywhere in the module — its position,
width and ramp are entirely derived from where `connector` and `aSite` ended up.

**`facing` disambiguation.** `Placement.facing` (used above as `Direction.North`)
accepts either a `Direction` member or a raw yaw in degrees, and picks between them by
value: integers 0–7 are read as `Direction` enum members (`North`, `NorthEast`, `East`,
... in 45° steps); anything else — negative, fractional, or 8 and up — is used as a
literal yaw. One consequence: `facing: 5` means `Direction.SouthWest` (enum member 5),
not a 5° yaw. A yaw of exactly 5 degrees isn't expressible as a literal — the nearest
values you can actually request are the enum's 45°-step directions or an integer yaw of
8 or more.

## CLI

| Command | What it does | Flags |
|---|---|---|
| `cs2ts init <addon>` | scaffold a Counter-Strike 2 addon in the game install | `--cs2-dir <path>` |
| `cs2ts emit <file>` | write a `.vmap` without compiling it | `--out <path>`, `--addon <name>`, `--cs2-dir <path>` |
| `cs2ts preview <file>` | fast compile, then launch CS2 | `--addon <name>` (required), `--cs2-dir <path>` |
| `cs2ts build <file>` | full compile with vis, nav and baked lighting | `--addon <name>` (required), `--cs2-dir <path>`, `--lightmap-resolution <n>`, `--lightmap-quality <n>` |

`<file>` and `<addon>` are positional/required arguments as shown; every other column
entry is an option flag. Run `cs2ts <command> --help` for the exact text at any time.

A typical flow:

```
cs2ts init my_addon                                  # once, to create the addon
cs2ts preview map.ts --addon my_addon                # fast look, launches CS2
cs2ts build map.ts --addon my_addon                  # production compile
```

For `de_example.ts` above, `cs2ts preview` compiles in about 3 seconds. `cs2ts build`
— which adds `vis`, `nav`, and a baked 1024×1024 lightmap via `vrad3` — takes about 67
seconds and produced a 1.79 MB `.vpk`.

`emit` is the odd one out: give it `--out <path>` and it writes a `.vmap` straight to
that path with no CS2 install involved at all (see [Prerequisites](#prerequisites)).
Give it `--addon` instead (with a CS2 install present) and it writes into that addon's
`maps/` folder, same as `preview` and `build` do before they compile.

## Opening the result in Hammer

Every command that writes into an addon puts the file at
`content/csgo_addons/<addon>/maps/<name>.vmap`. To open it:

1. In Steam, launch **Counter-Strike 2 Workshop Tools** (see
   [Prerequisites](#prerequisites) if it isn't installed).
2. Pick the addon that `cs2ts init` created — Hammer opens with that addon active.
3. `File > Open`, and navigate to
   `content/csgo_addons/<addon>/maps/<name>.vmap`.

It loads as an ordinary Hammer map, because it *is* one — cs2.ts writes the same file
format Hammer does, not an approximation of it. One caveat worth knowing up front:
cs2.ts only ever writes `.vmap`, never reads one back, so this is a one-way trip —
edits made in Hammer will be overwritten the next time you re-run `cs2ts` on the same
module.

## Prerequisites

- **Counter-Strike 2, with Workshop Tools installed.** In Steam: right-click
  Counter-Strike 2 > Properties > Installed Files > Install Counter-Strike 2 Workshop
  Tools. This is what provides `resourcecompiler.exe`, `vrad3.exe` and `cs2.exe`.
- **Windows, or WSL.** The compiler and CS2 itself are Windows binaries. Under WSL,
  the install has to be reachable at `/mnt/<drive>/...` — a copy living inside the WSL
  filesystem itself won't work.
- **A CS2 install named "Counter-Strike Global Offensive."** This isn't a typo in this
  README or in cs2ts — Valve still ships CS2 under its old CS:GO directory name, so
  don't go looking for a folder literally called "Counter-Strike 2".
- **Discovery.** Every command but `emit --out` needs to find the install. cs2ts reads
  Steam's `libraryfolders.vdf` to enumerate every Steam library, and looks for
  `steamapps/common/Counter-Strike Global Offensive` in each of them, in addition to
  the default `Program Files (x86)` location. Override the result with `--cs2-dir
  <path>` on any command, or the `CS2TS_CS2_DIR` environment variable.
- **`emit` is the only command that works with no CS2 install at all** — pass it
  `--out <path>` and it just writes the file there. Every other command runs a
  preflight check first and fails with an actionable message if the install, the
  compiler, or the target addon can't be found.

## Out of scope in v1

Not handled at all: props, models, custom materials and textures, arbitrary
non-convex shapes, rotated or diagonal geometry, L-shaped corridor routing, complex
entity I/O and connections, lighting design beyond the default sun/sky, `cs_script`
integration, prefabs and instances, displacements, 3D skyboxes, navmesh authoring,
Workshop publishing, and the MCP server.

A few narrower constraints are worth knowing before you hit them:

- Connections only run along the four cardinal directions. Diagonals exist as
  `Direction` members, but only for `facing` — a room or corridor can't be placed on a
  diagonal.
- `map.connect()` routes a single straight corridor between two already-placed rooms.
  If the only path between them is an L-shape, it raises a clear error naming both
  rooms rather than guessing a route — you'll need to route it yourself with an
  intermediate room.
- A corridor's `length` must be either 0 (a flush doorway, walls touching directly) or
  at least 32 units. Anything shorter can't fit both rooms' walls and is rejected.
- As noted under the example above, `Placement.facing` can't express every yaw
  literally: values 0–7 are `Direction` enum members, so an angle like 5° has no
  literal representation.
- Where two connected rooms have different footprint widths and meet flush (`length:
  0`), the wider room's wall isn't trimmed back to the narrower one — you get some
  overlapping brush at the T-junction. That's duplicate surface, not a gap: the map is
  still sealed and playable, just not perfectly tidy geometry at that joint.

## Credit

This project is built on reverse-engineering work by
[ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)
(MIT licensed). The `CDmePolygonMesh` format — Source 2's half-edge mesh
representation — was understood from their implementation, and the incremental
half-edge construction in `packages/sdk/src/vmap/mesh.ts` is a TypeScript port of the
algorithm in their
[`ValveResourceFormat/IO/HammerMeshBuilder.cs`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/IO/HammerMeshBuilder.cs),
specifically its `HammerMeshBuilder.GenerateMesh()`.
