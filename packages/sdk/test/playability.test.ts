import { expect, test } from 'bun:test'
import exampleMap from '../../../examples/de_example'
import { roomEntities } from '../src/entities'
import { solve } from '../src/solve'
import type { Passage, PlacedRoom } from '../src/solve'
import { toSolids } from '../src/solids'
import { Direction } from '../src/types'
import type { Solid, WedgeSolid } from '../src/types'

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
 * Unlike `insideAny` in solids.test.ts / ramps.test.ts, this treats a wedge
 * as the sloped triangular prism it actually is, not its bounding box. That
 * distinction only matters once you march a line *through* a ramp rather
 * than just probing past a flat wall: the reference map's two ramps are
 * tuned tightly enough (see the report) that treating them as solid up to
 * their full bounding-box height produces false "blocked" collisions a
 * player would never actually hit.
 */
function wedgeTopAt(s: WedgeSolid, x: number, y: number): number {
  const [x0, y0, z0] = s.min
  const [x1, y1, z1] = s.max
  switch (s.rise) {
    case Direction.East: return z0 + (z1 - z0) * (x - x0) / (x1 - x0)
    case Direction.West: return z0 + (z1 - z0) * (x1 - x) / (x1 - x0)
    case Direction.North: return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    case Direction.South: return z0 + (z1 - z0) * (y1 - y) / (y1 - y0)
  }
}

function insideSolid(s: Solid, p: readonly [number, number, number]): boolean {
  if (p[0] <= s.min[0]! || p[0] >= s.max[0]!) return false
  if (p[1] <= s.min[1]! || p[1] >= s.max[1]!) return false
  if (s.kind === 'box') return p[2] > s.min[2]! && p[2] < s.max[2]!
  const top = wedgeTopAt(s, p[0], p[1])
  return p[2] > s.min[2]! && p[2] < top
}

function insideAny(all: Solid[], p: readonly [number, number, number]): boolean {
  return all.some((s) => insideSolid(s, p))
}

/**
 * The height of whatever a player would be standing on at (x, y), or null
 * over open air/outside the map. `ceilingCap` excludes ceiling slabs and
 * lintels from the search — floor, ceiling and wall solids in this SDK all
 * carry the same dev material (see defaults.ts), so there is no material
 * tag to distinguish "floor" from "ceiling" by; a corridor's ceiling slab
 * sits strictly above its own clearance height (`passage.bounds.max[2]`),
 * so capping the search there is what keeps "the highest solid surface"
 * from picking the ceiling instead of the floor beneath it.
 */
function surfaceHeightAt(all: Solid[], x: number, y: number, ceilingCap: number): number | null {
  let best: number | null = null
  for (const s of all) {
    if (x <= s.min[0]! || x >= s.max[0]!) continue
    if (y <= s.min[1]! || y >= s.max[1]!) continue
    const top = s.kind === 'box' ? s.max[2]! : wedgeTopAt(s, x, y)
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
    const spawns = roomEntities(room, node).filter((e) => e.classname.startsWith('info_player_'))

    for (const spawn of spawns) {
      spawnCount++
      const [x, y, z] = spawn.origin

      expect(x).toBeGreaterThanOrEqual(room.bounds.min[0]!)
      expect(x).toBeLessThanOrEqual(room.bounds.max[0]!)
      expect(y).toBeGreaterThanOrEqual(room.bounds.min[1]!)
      expect(y).toBeLessThanOrEqual(room.bounds.max[1]!)

      // Sample through a player's standing height (feet to head), not just
      // the entity's origin, which sits exactly on the floor plane.
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
    const heights = sampleWalkingSurface(passage)

    const lo = Math.min(passage.fromZ, passage.toZ)
    const hi = Math.max(passage.fromZ, passage.toZ)
    const EPS = 0.5

    // Continuous at both ends: the corridor's floor at its very first and
    // very last sample must match the room floor it meets, not float above
    // or drop below it.
    expect(heights[0]!).toBeGreaterThanOrEqual(lo - EPS)
    expect(heights[0]!).toBeLessThanOrEqual(lo + EPS)
    expect(heights.at(-1)!).toBeGreaterThanOrEqual(hi - EPS)
    expect(heights.at(-1)!).toBeLessThanOrEqual(hi + EPS)

    // Monotonic and free of discontinuities: the total absolute movement in
    // z along the sampled surface should equal the net rise. If the surface
    // ever dipped, jumped past the target and came back, or had a step the
    // sampling resolution could see, the accumulated absolute delta would
    // exceed the net delta.
    let totalAbsDelta = 0
    for (let i = 1; i < heights.length; i++) totalAbsDelta += Math.abs(heights[i]! - heights[i - 1]!)
    expect(totalAbsDelta).toBeLessThanOrEqual(hi - lo + EPS)
  }
})

/** Walking-surface height sampled along a passage's own travel axis, corridor-width centred. */
function sampleWalkingSurface(passage: Passage): number[] {
  const axis = passage.axis
  const other: 0 | 1 = axis === 0 ? 1 : 0
  const axisMin = passage.bounds.min[axis]!
  const axisMax = passage.bounds.max[axis]!
  const centreOther = (passage.bounds.min[other]! + passage.bounds.max[other]!) / 2

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
    const h = surfaceHeightAt(solids, point[0], point[1], passage.bounds.max[2]!)
    if (h === null) {
      throw new Error(`no walking surface found along ramp at t=${t} (${point[0]}, ${point[1]})`)
    }
    heights.push(h)
  }
  return heights
}

test('the playable space is sealed: a ray from every room centre hits a solid before leaving the map', () => {
  const MARGIN = 256
  const STEP = 4

  const globalMin: [number, number] = [Infinity, Infinity]
  const globalMax: [number, number] = [-Infinity, -Infinity]
  for (const s of solids) {
    globalMin[0] = Math.min(globalMin[0], s.min[0]!)
    globalMin[1] = Math.min(globalMin[1], s.min[1]!)
    globalMax[0] = Math.max(globalMax[0], s.max[0]!)
    globalMax[1] = Math.max(globalMax[1], s.max[1]!)
  }

  for (const room of layout.rooms) {
    const [cx, cy] = centre(room)
    const z = room.floorZ + PLAYER_HEIGHT

    const directions: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    for (const [dx, dy] of directions) {
      const bound = dx === 1 ? globalMax[0] + MARGIN
        : dx === -1 ? globalMin[0] - MARGIN
        : dy === 1 ? globalMax[1] + MARGIN
        : globalMin[1] - MARGIN

      let hit = false
      let x = cx, y = cy
      // Distance from the room centre to its own direction-relevant bound,
      // plus margin, sets how far a genuine leak would have to go undetected.
      const limit = dx !== 0 ? Math.abs(bound - cx) : Math.abs(bound - cy)
      for (let d = 0; d <= limit; d += STEP) {
        x = cx + dx * d
        y = cy + dy * d
        if (insideAny(solids, [x, y, z])) { hit = true; break }
      }

      expect(hit).toBe(true)
    }
  }
})
