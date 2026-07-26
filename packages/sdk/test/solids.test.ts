import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { subtractIntervals, toSolids } from '../src/solids'
import { Direction, Transition } from '../src/types'
import type { Solid } from '../src/types'

/** True if point `p` lies strictly inside any of the given axis-aligned solids. */
function insideAny(solids: Solid[], p: readonly [number, number, number]): boolean {
  return solids.some((s) =>
    p[0] > s.min[0]! && p[0] < s.max[0]! &&
    p[1] > s.min[1]! && p[1] < s.max[1]! &&
    p[2] > s.min[2]! && p[2] < s.max[2]!)
}

/** Volume of the intersection of two boxes, 0 if they do not overlap. */
function overlapVolume(a: Solid, b: Solid): number {
  let v = 1
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.min[i]!, b.min[i]!)
    const hi = Math.min(a.max[i]!, b.max[i]!)
    if (hi <= lo) return 0
    v *= hi - lo
  }
  return v
}

test('interval subtraction handles the interesting cases', () => {
  const span = { lo: 0, hi: 1024 }
  expect(subtractIntervals(span, [])).toEqual([{ lo: 0, hi: 1024 }])
  expect(subtractIntervals(span, [{ lo: 256, hi: 384 }]))
    .toEqual([{ lo: 0, hi: 256 }, { lo: 384, hi: 1024 }])
  // flush to the start
  expect(subtractIntervals(span, [{ lo: 0, hi: 256 }]))
    .toEqual([{ lo: 256, hi: 1024 }])
  // flush to the end
  expect(subtractIntervals(span, [{ lo: 768, hi: 1024 }]))
    .toEqual([{ lo: 0, hi: 768 }])
  // full width leaves nothing
  expect(subtractIntervals(span, [{ lo: 0, hi: 1024 }])).toEqual([])
  // two holes, unsorted input
  expect(subtractIntervals(span, [{ lo: 700, hi: 800 }, { lo: 100, hi: 200 }]))
    .toEqual([{ lo: 0, hi: 100 }, { lo: 200, hi: 700 }, { lo: 800, hi: 1024 }])
  // overlapping holes merge
  expect(subtractIntervals(span, [{ lo: 100, hi: 300 }, { lo: 200, hi: 400 }]))
    .toEqual([{ lo: 0, hi: 100 }, { lo: 400, hi: 1024 }])
})

test('a lone room becomes a sealed shell', () => {
  const map = new CS2Map('t')
  map.room({ name: 'only', size: [512, 512, 192] })
  const solids = toSolids(solve(map.graph))
  // floor, ceiling, four walls
  expect(solids).toHaveLength(6)
  expect(solids.every((s) => s.kind === 'box')).toBe(true)

  const floor = solids[0]!
  expect(floor.min[2]).toBe(-16)
  expect(floor.max[2]).toBe(0)

  // A solid *count* can't distinguish a correctly-sealed room from one whose
  // walls, floor or ceiling ended up in the wrong place. Probe just past each
  // of the room's six interior faces: every probe must land inside some
  // emitted solid.
  const probes: Array<[number, number, number]> = [
    [-256.5, 0, 96], [256.5, 0, 96],
    [0, -256.5, 96], [0, 256.5, 96],
    [0, 0, -0.5], [0, 0, 192.5],
  ]
  for (const p of probes) expect(insideAny(solids, p)).toBe(true)
})

test('a full-height doorway splits one wall into two boxes', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 512, 192] })
  a.room({ name: 'b', size: [1024, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, height: 192 })
  const solids = toSolids(solve(map.graph))

  // a's north wall spans x -512..512 with a 128-wide hole centred at 0
  const northWallPieces = solids.filter(
    (s) => s.min[1]! >= 256 && s.max[1]! <= 272 && s.max[2]! === 192)
  expect(northWallPieces).toHaveLength(2)
  expect(northWallPieces.map((s) => [s.min[0], s.max[0]]).sort((p, q) => p[0]! - q[0]!))
    .toEqual([[-512, -64], [64, 512]])

  // b's near (south) wall carries the same split: the destination room's
  // side of the doorway, not just the origin room's.
  const bNearWallPieces = solids.filter(
    (s) => s.min[1]! >= 240 && s.max[1]! <= 256 && s.max[2]! === 192)
  expect(bNearWallPieces).toHaveLength(2)
  expect(bNearWallPieces.map((s) => [s.min[0], s.max[0]]).sort((p, q) => p[0]! - q[0]!))
    .toEqual([[-512, -64], [64, 512]])

  // b's far (north) wall, opposite the doorway, stays a single unbroken
  // piece - exactly where an inverted sideFacing would put the hole instead.
  const bFarWallPieces = solids.filter(
    (s) => s.min[1]! >= 768 && s.max[1]! <= 784 && s.max[2]! === 192)
  expect(bFarWallPieces).toHaveLength(1)
  expect([bFarWallPieces[0]!.min[0], bFarWallPieces[0]!.max[0]]).toEqual([-512, 512])
})

test('a partial-height opening adds a lintel', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 512, 192] })
  a.room({ name: 'b', size: [1024, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, height: 128 })
  const solids = toSolids(solve(map.graph))

  const lintel = solids.find(
    (s) => s.min[0] === -64 && s.max[0] === 64 && s.min[2] === 128 && s.max[2] === 192)
  expect(lintel).toBeDefined()
})

test('a straight line reaches the connected room through its doorway, but not past the far wall', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 512, 192] })
  a.room({ name: 'b', size: [1024, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, height: 192 })
  const solids = toSolids(solve(map.graph))

  // March along x=0, z=96 (mid-height) and report the first y at which the
  // point lands inside a solid, or null if the whole run is clear.
  const firstHit = (fromY: number, toY: number): number | null => {
    const steps = 400
    for (let i = 0; i <= steps; i++) {
      const y = fromY + (toY - fromY) * (i / steps)
      if (insideAny(solids, [0, y, 96])) return y
    }
    return null
  }

  // a's centre (y=0) to b's centre (y=512): straight through the doorway.
  expect(firstHit(0, 512)).toBeNull()

  // From b's centre, heading further north past its far, unbroken wall.
  expect(firstHit(512, 900)).not.toBeNull()
})

test('every emitted solid has positive volume across a sweep of shapes, openings and rises', () => {
  const checkAll = (map: CS2Map) => {
    for (const s of toSolids(solve(map.graph))) {
      expect(s.max[0]! - s.min[0]!).toBeGreaterThan(0)
      expect(s.max[1]! - s.min[1]!).toBeGreaterThan(0)
      expect(s.max[2]! - s.min[2]!).toBeGreaterThan(0)
    }
  }

  // The original asymmetric case: differently-sized rooms, a corridor.
  {
    const map = new CS2Map('t')
    const a = map.room({ name: 'a', size: [1024, 768, 192] })
    a.room({ name: 'b', size: [512, 512, 192] },
      { direction: Direction.North, width: 192, length: 256 })
    checkAll(map)
  }

  const sizes: Array<[number, number, number]> = [
    [1024, 768, 192], [512, 512, 192], [768, 640, 256],
  ]
  const widths = [64, 128, 192]
  const heights = [0, 64, 128, 192]
  const rises = [0, 32, 96]
  const lengths = [0, 256]
  const transitions = [Transition.Step, Transition.Ramp, Transition.Stairs]

  for (const size of sizes) {
    for (const width of widths) {
      for (const height of heights) {
        for (const rise of rises) {
          for (const length of lengths) {
            for (const via of transitions) {
              // A non-zero rise with zero length and a non-Step transition
              // has no room for a ramp or stairs and is rejected by the
              // solver (SLOPE_WITHOUT_RUN) — not a positive-volume concern.
              if (rise !== 0 && length === 0 && via !== Transition.Step) continue
              const map = new CS2Map('t')
              const a = map.room({ name: 'a', size })
              a.room({ name: 'b', size }, {
                direction: Direction.North, width, length, height, rise, via,
              })
              checkAll(map)
            }
          }
        }
      }
    }
  }
})

test.each([Direction.North, Direction.East, Direction.South, Direction.West])(
  'solids never overlap each other, flush or corridor, facing %i',
  (direction) => {
    for (const length of [0, 32, 256]) {
      const map = new CS2Map('t')
      const a = map.room({ name: 'a', size: [512, 512, 192] })
      a.room({ name: 'b', size: [512, 512, 192] },
        { direction, width: 128, length })
      const solids = toSolids(solve(map.graph))

      let total = 0
      for (let i = 0; i < solids.length; i++) {
        for (let j = i + 1; j < solids.length; j++) {
          total += overlapVolume(solids[i]!, solids[j]!)
        }
      }
      expect(total).toBe(0)
    }
  },
)
