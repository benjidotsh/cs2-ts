import { expect, test } from 'bun:test'
import exampleMap from '../../../examples/de_example'
import { SPAWN_FLOOR_CLEARANCE } from '../src/defaults'
import { roomEntities, intrudingWalls } from '../src/entities'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import type { Passage, PlacedRoom } from '../src/solve'
import { toSolids } from '../src/solids'
import { CARDINALS, Direction } from '../src/types'
import type { Solid, Vec3 } from '../src/types'
import { analyseSeal, roomSeeds } from './support/seal'
import { solidSpanAt } from './support/wedge'

/**
 * This is the substitute for the human walkthrough Task 17 hands off to a
 * person at a keyboard: it loads the actual shipped `examples/de_example.ts`
 * (not a locally re-typed copy, unlike the other test files in this package)
 * and checks the same things a walk would reveal — spawns that aren't inside
 * a wall, rooms that are mutually reachable, ramps that climb continuously,
 * and a world that doesn't leak. What it can't see is covered in the task 17
 * report: texture/visual issues, whether the ramp *feels* right underfoot,
 * and anything geometry-shaped that isn't expressible as a mechanical check.
 */
const layout = solve(exampleMap.graph)
const solids = toSolids(layout)

// Approximate CS2 player eye height above the floor they're standing on.
const PLAYER_HEIGHT = 64

/**
 * Unlike `insideAny` in solids.test.ts, this treats a wedge as the sloped
 * triangular prism it actually is, not its bounding box. That distinction only
 * matters once you march a line *through* a ramp rather than just probing past
 * a flat wall: the reference map's two ramps are tuned tightly enough (see the
 * report) that treating them as solid up to their full bounding-box height
 * produces false "blocked" collisions a player would never actually hit.
 */
function insideSolid(s: Solid, p: readonly [number, number, number]): boolean {
  const span = solidSpanAt(s, p[0], p[1])
  return span !== null && p[2] > span[0] && p[2] < span[1]
}

function insideAny(all: Solid[], p: readonly [number, number, number]): boolean {
  return all.some((s) => insideSolid(s, p))
}

/**
 * The height of whatever a player would be standing on at (x, y), or null
 * over open air/outside the map. `ceilingCap` excludes ceiling slabs and
 * lintels from the search — floor, ceiling and wall solids in this SDK all
 * carry the same dev material (see defaults.ts), so there is no material
 * tag to distinguish "floor" from "ceiling" by. The cap is the clear height
 * at this exact point along the corridor, not one number for the whole run:
 * a corridor's roof climbs with its floor, so a single cap taken from the
 * high end would let a lintel at the low end read as a walking surface.
 */
function surfaceHeightAt(all: Solid[], x: number, y: number, ceilingCap: number): number | null {
  let best: number | null = null
  for (const s of all) {
    // An upside-down wedge is a ceiling; nothing stands on its underside.
    if (s.kind === 'wedge' && s.inverted) continue
    // Through solidSpanAt, so this oracle and insideSolid above read the wedge
    // plane the same way: its top is the surface you would stand on.
    const span = solidSpanAt(s, x, y)
    if (span === null) continue
    const top = span[1]
    if (top > ceilingCap + 1e-6) continue
    if (best === null || top > best) best = top
  }
  return best
}

function centre(room: PlacedRoom): [number, number] {
  return [(room.bounds.min[0]! + room.bounds.max[0]!) / 2, (room.bounds.min[1]! + room.bounds.max[1]!) / 2]
}

const roomsById = new Map(layout.rooms.map((r) => [r.id, r]))

test('every spawn point lies inside its room and is not inside any solid', () => {
  expect(layout.rooms.length).toBeGreaterThan(0)
  let spawnCount = 0

  for (const room of layout.rooms) {
    const node = exampleMap.graph.rooms.find((r) => r.id === room.id)!
    const spawns = roomEntities(room, node, intrudingWalls(room, layout.rooms)).filter((e) => e.classname.startsWith('info_player_'))

    for (const spawn of spawns) {
      spawnCount++
      const [x, y, z] = spawn.origin

      expect(x).toBeGreaterThanOrEqual(room.bounds.min[0]!)
      expect(x).toBeLessThanOrEqual(room.bounds.max[0]!)
      expect(y).toBeGreaterThanOrEqual(room.bounds.min[1]!)
      expect(y).toBeLessThanOrEqual(room.bounds.max[1]!)
      // The x/y and not-inside-a-solid checks below can't see a spawn placed
      // below the floor slab: dropping straight down from z=0 to some large
      // negative offset lands in open air under the map (not inside any
      // solid), and clears the floor bounds check entirely since that only
      // looks at x/y. A spawn has to sit a fixed clearance above the floor
      // it's placed in, not merely outside of solids — sitting exactly ON
      // the floor is what CS2 itself rejects (coplanar with the floor's top
      // face reads as stuck in geometry to the engine's hull check), which
      // is a distinct condition from being inside a solid and is exactly
      // what let that bug ship undetected.
      expect(z).toBeCloseTo(room.floorZ + SPAWN_FLOOR_CLEARANCE, 6)

      // The point directly below the spawn must be solid ground (the floor
      // slab), not open air — otherwise a spawn floating in mid-air with no
      // floor under it at all would pass every check above.
      expect(insideAny(solids, [x, y, room.floorZ - 1])).toBe(true)

      // Sample through a player's standing height (feet to head), not just
      // the entity's origin, which sits a fixed clearance above the floor.
      for (const dz of [1, 36, 70]) {
        expect(insideAny(solids, [x, y, z + dz])).toBe(false)
      }
    }
  }

  // A spawn check over zero spawns would pass vacuously; the example is
  // known to author 10, so require at least one to keep this test honest.
  expect(spawnCount).toBeGreaterThan(0)
})

test('every emitted solid has strictly positive volume on all three axes', () => {
  expect(solids.length).toBeGreaterThan(0)
  for (const s of solids) {
    expect(s.max[0]! - s.min[0]!).toBeGreaterThan(0)
    expect(s.max[1]! - s.min[1]!).toBeGreaterThan(0)
    expect(s.max[2]! - s.min[2]!).toBeGreaterThan(0)
  }
})

test('every connected pair of rooms is reachable by a clear line through the doorway', () => {
  expect(layout.passages.length).toBeGreaterThan(0)

  for (const passage of layout.passages) {
    const from = roomsById.get(passage.from)!
    const to = roomsById.get(passage.to)!
    const [fx, fy] = centre(from)
    const [tx, ty] = centre(to)
    const a: [number, number, number] = [fx, fy, from.floorZ + PLAYER_HEIGHT]
    const b: [number, number, number] = [tx, ty, to.floorZ + PLAYER_HEIGHT]

    const STEPS = 500
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const p: [number, number, number] = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]
      if (insideAny(solids, p)) {
        throw new Error(
          `line from "${from.name}" to "${to.name}" hits a solid at t=${t}, ` +
          `point (${p[0]}, ${p[1]}, ${p[2]})`,
        )
      }
    }
  }
})

test('every ramp or stair climbs monotonically from one floor to the other with no discontinuity', () => {
  const rising = layout.passages.filter((p) => p.toZ !== p.fromZ)
  // The reference map has two ramps (mid->aSite and connector->aSite); if a
  // future edit to the example removes both, this would pass vacuously —
  // guard against that so the check stays meaningful.
  expect(rising.length).toBeGreaterThan(0)

  for (const passage of rising) {
    const from = roomsById.get(passage.from)!
    const to = roomsById.get(passage.to)!
    assertMonotonicClimb(from, to, passage, sampleWalkingSurface(solids, passage, from))
  }
})

// Both of de_example's rises happen to place the "from" room at the passage's
// axis-min end, which makes corridorSolids()'s `fromAtMinEnd ===
// (toZ > fromZ)` term a no-op for North/East connections — the exact
// regression Task 10 fixed (a South/West rise climbing the wrong way) is
// invisible to the test above no matter how it samples, because the fixture
// never places a room at the axis-max end. Covering all four cardinals here,
// on a small synthetic map, is what actually exercises the failing quadrant.
test.each([...CARDINALS])(
  'a ramp climbs monotonically to the upper floor, facing %s',
  (direction) => {
    const map = new CS2Map('t')
    const a = map.room({ name: 'a', size: [512, 512, 192] })
    a.room({ name: 'b', size: [512, 512, 192] },
      { direction, width: 192, length: 384, rise: 128 })
    const localLayout = solve(map.graph)
    const localSolids = toSolids(localLayout)
    const passage = localLayout.passages.find((p) => p.toZ !== p.fromZ)!
    const from = localLayout.rooms.find((r) => r.id === passage.from)!
    const to = localLayout.rooms.find((r) => r.id === passage.to)!

    assertMonotonicClimb(from, to, passage, sampleWalkingSurface(localSolids, passage, from))
  },
)

/**
 * `heights[0]` is sampled at the passage's axis-min end and `heights.at(-1)`
 * at its axis-max end — but which room (`from` or `to`) physically sits at
 * which end depends on the connection's direction/sign (North/East place the
 * child at axis-max; South/West place it at axis-min), not on axis order.
 * Deriving that mapping here from the rooms' own placed bounds (solve()'s
 * output) — rather than trusting corridorSolids()'s internal `fromAtMinEnd`
 * — is what keeps this oracle independent of the exact code path a
 * direction-sign regression would corrupt: if solids.ts's wedge-orientation
 * logic breaks, this check must still know which end is meant to be lo and
 * which is meant to be hi.
 */
function assertMonotonicClimb(from: PlacedRoom, to: PlacedRoom, passage: Passage, heights: number[]): void {
  const atMin = fromAtAxisMin(from, passage)
  const axisMinZ = atMin ? from.floorZ : to.floorZ
  const axisMaxZ = atMin ? to.floorZ : from.floorZ
  const EPS = 0.5

  // Continuous at both ends: the corridor's floor at its very first and
  // very last sample must match the room floor it meets there, not float
  // above or drop below it — and not just "match one of the two floors",
  // which end matches which specifically.
  expect(heights[0]!).toBeGreaterThanOrEqual(axisMinZ - EPS)
  expect(heights[0]!).toBeLessThanOrEqual(axisMinZ + EPS)
  expect(heights.at(-1)!).toBeGreaterThanOrEqual(axisMaxZ - EPS)
  expect(heights.at(-1)!).toBeLessThanOrEqual(axisMaxZ + EPS)

  // Monotonic and free of discontinuities: the total absolute movement in
  // z along the sampled surface should equal the net rise. If the surface
  // ever dipped, jumped past the target and came back, or had a step the
  // sampling resolution could see, the accumulated absolute delta would
  // exceed the net delta.
  let totalAbsDelta = 0
  for (let i = 1; i < heights.length; i++) totalAbsDelta += Math.abs(heights[i]! - heights[i - 1]!)
  expect(totalAbsDelta).toBeLessThanOrEqual(Math.abs(axisMaxZ - axisMinZ) + EPS)
}

/**
 * Whether `from` sits at the passage's axis-min end, derived from the rooms'
 * own placed bounds rather than from anything solids.ts computed.
 */
function fromAtAxisMin(from: PlacedRoom, passage: Passage): boolean {
  return from.bounds.max[passage.axis]! <= passage.bounds.min[passage.axis]! + 1e-6
}

/** Walking-surface height sampled along a passage's own travel axis, corridor-width centred. */
function sampleWalkingSurface(all: Solid[], passage: Passage, from: PlacedRoom): number[] {
  const axis = passage.axis
  const other: 0 | 1 = axis === 0 ? 1 : 0
  const axisMin = passage.bounds.min[axis]!
  const axisMax = passage.bounds.max[axis]!
  const centreOther = (passage.bounds.min[other]! + passage.bounds.max[other]!) / 2

  // The clear height at each end, mapped onto the passage's own axis: the
  // roof climbs with the floor, so the cap has to move with it.
  const ceilAtMin = fromAtAxisMin(from, passage) ? passage.fromCeilingZ : passage.toCeilingZ
  const ceilAtMax = fromAtAxisMin(from, passage) ? passage.toCeilingZ : passage.fromCeilingZ

  const STEPS = 200
  // Inset from the exact ends by a hair so the sample doesn't land exactly
  // on a solid's boundary plane, where strict inequality would read as
  // "outside" regardless of the true surface there.
  const inset = (axisMax - axisMin) * 0.001
  const heights: number[] = []
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    const pos = axisMin + inset + (axisMax - axisMin - 2 * inset) * t
    const point: [number, number] = axis === 0 ? [pos, centreOther] : [centreOther, pos]
    const cap = ceilAtMin + (ceilAtMax - ceilAtMin) * ((pos - axisMin) / (axisMax - axisMin))
    const h = surfaceHeightAt(all, point[0], point[1], cap)
    if (h === null) {
      throw new Error(`no walking surface found along ramp at t=${t} (${point[0]}, ${point[1]})`)
    }
    heights.push(h)
  }
  return heights
}

test('the playable space is sealed: nothing reachable from a room centre gets out', () => {
  // This used to march a ray from each room centre in the four cardinal
  // directions at one height. Four lines through a map cannot see a leak you
  // reach by stepping sideways first, and this map had one: an aperture beside
  // the ramp into aSite, open to the void under that room's raised floor. The
  // flood fill in ./support/seal walks every connected pocket of air instead.
  // The matrix in seal.test.ts covers the layouts the example doesn't.
  const analysis = analyseSeal(solids, roomSeeds(layout.rooms, PLAYER_HEIGHT))
  expect(analysis.leak).toBeNull()

  // The specific point the final review escaped through: beside the mid→aSite
  // ramp, 60 units up, below aSite's floor at 128. It must now be solid.
  expect(analysis.solidAt([1370, 890, 60])).toBe(true)
})
