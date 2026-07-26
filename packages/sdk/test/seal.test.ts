import { expect, test } from 'bun:test'
import { Cs2tsError } from '../src/errors'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { toSolids } from '../src/solids'
import { Direction, Transition } from '../src/types'
import type { Cardinal, Vec3 } from '../src/types'
import { analyseSeal } from './support/seal'

/**
 * The map may not leak. Not "the reference map may not leak" — *the map*, for
 * every layout the solver is willing to produce.
 *
 * The shipped seal check ran against `examples/de_example.ts` and nothing
 * else, which is why a leak that fires on any connection with a rise, and on
 * any full-width doorway, shipped anyway. This sweeps the axes that actually
 * change the geometry: all four cardinals (the sign of the travel axis flips
 * which room owns which end), rises up and down, all three transitions, flush
 * / minimum-length / long corridors, and — the case an author writes without
 * thinking twice — a doorway exactly as wide as the shared face.
 */

const ROOM: Vec3 = [512, 512, 192]
/** Both rooms are 512 deep, so the shared face spans exactly 512 units. */
const SPAN = 512

const DIRECTIONS: Cardinal[] = [
  Direction.North, Direction.East, Direction.South, Direction.West,
]
const VIAS = [Transition.Step, Transition.Ramp, Transition.Stairs]
const RISES = [0, 64, 128, -64]
const LENGTHS = [0, 32, 256]
const WIDTHS = [192, SPAN]

interface Case {
  direction: Cardinal
  via: Transition
  rise: number
  length: number
  width: number
}

function twoRooms(c: Case): CS2Map {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [...ROOM] })
  a.room({ name: 'b', size: [...ROOM] }, {
    direction: c.direction, width: c.width, length: c.length,
    rise: c.rise, via: c.via,
  })
  return map
}

/**
 * Runs the leak analysis on a solved map, seeding the flood fill at standing
 * height in the centre of every room. Returns a human-readable failure, or
 * null when the layout is sealed and every room is reachable from the first.
 *
 * The reachability half matters as much as the seal: bricking every doorway
 * shut would seal the map perfectly, and this is what stops that from being
 * an acceptable way to make the test pass.
 */
function checkSealed(map: CS2Map): string | null {
  const layout = solve(map.graph)
  const solids = toSolids(layout)
  const seeds: Vec3[] = layout.rooms.map((r) => [
    (r.bounds.min[0]! + r.bounds.max[0]!) / 2,
    (r.bounds.min[1]! + r.bounds.max[1]!) / 2,
    r.floorZ + 32,
  ])

  const analysis = analyseSeal(solids, [seeds[0]!])
  if (analysis.leak) {
    const p = analysis.leak.escapeAt
    return `leaks: open space reaches (${p.map((v) => v.toFixed(1)).join(', ')})`
  }
  for (let i = 1; i < seeds.length; i++) {
    if (!analysis.reaches(seeds[i]!)) {
      return `room "${layout.rooms[i]!.name}" is not reachable from "${layout.rooms[0]!.name}"`
    }
  }
  return null
}

/** Solver rejections are not leaks — a layout it refuses to build can't leak. */
function checkAccepted(map: CS2Map): string | null | 'rejected' {
  try {
    return checkSealed(map)
  } catch (error) {
    if (error instanceof Cs2tsError) return 'rejected'
    throw error
  }
}

const label = (c: Case) =>
  `${c.direction} ${c.via} rise=${c.rise} ` +
  `length=${c.length} width=${c.width}`

for (const direction of DIRECTIONS) {
  for (const via of VIAS) {
    test(`no layout leaks: ${direction} via ${via}`, () => {
      const failures: string[] = []
      let accepted = 0

      for (const rise of RISES) {
        for (const length of LENGTHS) {
          for (const width of WIDTHS) {
            const c: Case = { direction, via, rise, length, width }
            const result = checkAccepted(twoRooms(c))
            if (result === 'rejected') continue
            accepted++
            if (result !== null) failures.push(`${label(c)}: ${result}`)
          }
        }
      }

      // Every (direction, via) pair must actually build most of its 24
      // combinations, or the sweep above would be asserting nothing much.
      // Step accepts 18 (it refuses only the 128-unit rise, too tall to
      // climb); ramps and stairs accept 12 (they also need run for their
      // rise). A guard that started rejecting layouts wholesale would show up
      // here rather than turning the sweep silently vacuous.
      expect(accepted).toBe(via === Transition.Step ? 18 : 12)
      expect(failures).toEqual([])
    })
  }
}

// The two triggers that need to be named outright rather than left to a
// sweep: they are the ones a reasonable author hits first.

test('a doorway as wide as the shared face does not open a hole beside the corridor', () => {
  // width === span is the single legal full-width value: anything wider is
  // rejected as INSUFFICIENT_FACE_OVERLAP. With no rise at all, this leaked
  // out along the travel axis because the room emits no wall solids on that
  // face and the corridor's side walls were inset away from the end zone.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [...ROOM] })
  a.room({ name: 'b', size: [...ROOM] },
    { direction: Direction.East, width: SPAN, length: 256, rise: 0 })
  expect(checkSealed(map)).toBeNull()
})

test('a narrower doorway in the same layout stays sealed too', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [...ROOM] })
  a.room({ name: 'b', size: [...ROOM] },
    { direction: Direction.East, width: SPAN - 1, length: 256, rise: 0 })
  expect(checkSealed(map)).toBeNull()
})

test('a stepped rise does not open the doorway under the higher room floor', () => {
  // Transition.Step cuts the lower room's wall full height while the higher
  // room's floor slab sits `rise` units up, leaving a doorway-wide aperture
  // into the unbounded space beneath that slab.
  for (const length of [0, 256]) {
    const map = new CS2Map('t')
    const a = map.room({ name: 'a', size: [...ROOM] })
    a.room({ name: 'b', size: [...ROOM] },
      { direction: Direction.North, width: 192, length, rise: 64, via: Transition.Step })
    expect(checkSealed(map)).toBeNull()
  }
})

test('stairs whose last tread is shallower than a wall stay sealed', () => {
  // 128 of rise over 160 of run is 16 risers of 10 units of tread: the top
  // tread no longer covers the 16-unit zone the adjoining room's wall was
  // assumed to own.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [...ROOM] })
  a.room({ name: 'b', size: [...ROOM] },
    { direction: Direction.North, width: 192, length: 160, rise: 128, via: Transition.Stairs })
  expect(checkSealed(map)).toBeNull()
})

test.each(DIRECTIONS)(
  'a corridor climbing past the lower room\'s ceiling is sealed and reachable, facing %s',
  (direction) => {
    // The solver used to refuse this outright (INSUFFICIENT_CLEARANCE) because
    // a flat roof capped at "a"'s ceiling left the doorway into "b" with no
    // opening in it. Now that the roof climbs with the floor the layout is
    // buildable — which is only an improvement if it is also sealed and "b"
    // is actually reachable, which is what this asserts.
    const map = new CS2Map('t')
    const a = map.room({ name: 'a', size: [...ROOM] })
    a.room({ name: 'b', size: [...ROOM] },
      { direction, width: 192, length: 256, rise: 192 })
    expect(checkSealed(map)).toBeNull()
  },
)

test('a cross-edge corridor closing a loop is sealed', () => {
  // map.connect() derives its rise from the two rooms' placed floor heights
  // rather than being told one, so the only way to exercise a cross-edge
  // ramp is to give one of the rooms a rise on the way in.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 768, 192] })
  const b = a.room({ name: 'b', size: [2048, 1024, 192] },
    { direction: Direction.North, width: 192, length: 512, rise: 64 })
  const c = a.room({ name: 'c', size: [1024, 768, 192] },
    { direction: Direction.East, width: 192, length: 256 })
  map.connect(c, b, { width: 192 })
  expect(checkSealed(map)).toBeNull()
})
