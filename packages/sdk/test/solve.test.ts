import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { Direction, Transition } from '../src/types'
import { SolverError } from '../src/errors'
import { thrown } from './support/errors'

function referenceMap() {
  const map = new CS2Map('de_example')
  const tSpawn = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
  const mid = tSpawn.room({ name: 'mid', size: [1536, 1024, 256] },
    { direction: Direction.North, width: 192, length: 512 })
  const aSite = mid.room({ name: 'aSite', size: [1024, 1024, 256] },
    { direction: Direction.East, width: 256, length: 384, rise: 128, via: Transition.Ramp })
  const conn = tSpawn.room({ name: 'connector', size: [1024, 768, 192] },
    { direction: Direction.East, width: 192, length: 256 })
  map.connect(conn, aSite, { width: 192 })
  return { map, tSpawn, mid, aSite, conn }
}

const xy = (b: { min: number[]; max: number[] }) =>
  [[b.min[0], b.max[0]], [b.min[1], b.max[1]]]

test('reference layout matches the spec worked example', () => {
  const layout = solve(referenceMap().map.graph)
  const byName = Object.fromEntries(layout.rooms.map((r) => [r.name, r]))

  expect(xy(byName.tSpawn!.bounds)).toEqual([[-512, 512], [-384, 384]])
  expect(xy(byName.mid!.bounds)).toEqual([[-768, 768], [896, 1920]])
  expect(xy(byName.aSite!.bounds)).toEqual([[1152, 2176], [896, 1920]])
  expect(xy(byName.connector!.bounds)).toEqual([[768, 1792], [-384, 384]])

  expect(byName.tSpawn!.floorZ).toBe(0)
  expect(byName.mid!.floorZ).toBe(0)
  expect(byName.aSite!.floorZ).toBe(128)
  expect(byName.connector!.floorZ).toBe(0)

  // ceilings are floor + size z
  expect(byName.aSite!.bounds.max[2]).toBe(128 + 256)
})

test('passages are centred on the overlap of the facing walls', () => {
  const layout = solve(referenceMap().map.graph)
  const find = (from: string, to: string) => {
    const ids = Object.fromEntries(layout.rooms.map((r) => [r.name, r.id]))
    return layout.passages.find(
      (p) => (p.from === ids[from] && p.to === ids[to]) ||
             (p.from === ids[to] && p.to === ids[from]))!
  }

  expect(xy(find('tSpawn', 'mid').bounds)).toEqual([[-96, 96], [384, 896]])
  expect(xy(find('mid', 'aSite').bounds)).toEqual([[768, 1152], [1280, 1536]])
  expect(xy(find('tSpawn', 'connector').bounds)).toEqual([[512, 768], [-96, 96]])
  expect(xy(find('connector', 'aSite').bounds)).toEqual([[1376, 1568], [384, 896]])
})

test('cross connection derives its rise rather than taking one', () => {
  const layout = solve(referenceMap().map.graph)
  const ids = Object.fromEntries(layout.rooms.map((r) => [r.name, r.id]))
  const p = layout.passages.find(
    (x) => x.from === ids.connector && x.to === ids.aSite)!
  expect(p.fromZ).toBe(0)
  expect(p.toZ).toBe(128)
})

test('offset shifts the child along the other horizontal axis', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, offset: 128 })
  const layout = solve(map.graph)
  expect(xy(layout.rooms[1]!.bounds)).toEqual([[-128, 384], [256, 768]])
})

test('overlapping rooms are reported with both names', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 512 })
  b.room({ name: 'c', size: [2048, 2048, 192] },
    { direction: Direction.South, width: 128, length: 0 })

  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('OVERLAP')
  expect(error.detail.rooms).toEqual(['a', 'c'])
})

test('a connection wider than the shared face is rejected', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [256, 256, 192] })
  const error = thrown(SolverError, () => {
    a.room({ name: 'b', size: [256, 256, 192] },
      { direction: Direction.North, width: 512, length: 0 })
    solve(map.graph)
  })
  expect(error.code).toBe('INSUFFICIENT_FACE_OVERLAP')
})

test('a rise with no run is rejected', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, rise: 64 })
  expect(thrown(SolverError, () => solve(map.graph)).code).toBe('SLOPE_WITHOUT_RUN')
})

test('a placement rise steeper than its run is a rise conflict', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256, rise: 300 })
  expect(thrown(SolverError, () => solve(map.graph)).code).toBe('RISE_CONFLICT')
})

test('a placement rise exactly equal to its run (1:1) is accepted', () => {
  // The rooms are 512 tall so that a 256-unit rise still leaves clear height
  // through the doorway; the point under test is the 1:1 slope boundary, and
  // a 192-tall room would fail the separate clearance check first.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 512] })
  a.room({ name: 'b', size: [512, 512, 512] },
    { direction: Direction.North, width: 128, length: 256, rise: 256 })
  expect(() => solve(map.graph)).not.toThrow()
})

// Found by the seal sweep, which flagged these layouts as sealed but with the
// second room unreachable: a doorway in a shared wall is capped at the lower
// of the two rooms' ceilings, so a step that lifts one floor to the other
// room's ceiling leaves a doorway with no opening in it. It compiled, and you
// could not get through it.
//
// A *corridor* is a different matter: it carries its own roof, which climbs
// with its floor, so it can join two rooms whose floors and ceilings do not
// overlap at all (see "a corridor may climb past the lower room's ceiling"
// below). Only a flush doorway, which has no roof of its own, can still run
// out of clear height.
test('a step that reaches the other room\'s ceiling leaves no clearance', () => {
  const map = new CS2Map('t')
  // "a" is only 64 tall, and "b" starts a whole 64 above it: the shared wall
  // has nothing left to cut a doorway out of.
  const a = map.room({ name: 'a', size: [512, 512, 64] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, rise: 64, via: Transition.Step })
  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('INSUFFICIENT_CLEARANCE')
  expect(error.detail).toMatchObject({ ceiling: 64, floor: 64 })
})

test('a flush cross connection with no clear height above the higher floor is rejected', () => {
  // Every placement edge here is fine on its own: "ground" is short but level
  // with "north", and "east" steps up only 64 inside a room tall enough to
  // take it. The cross edge is the one that pairs a floor at 64 with a
  // ceiling at 64 — and the two rooms are flush, so there is no corridor to
  // carry a roof over the difference.
  const map = new CS2Map('t')
  const ground = map.room({ name: 'ground', size: [1024, 512, 64] })
  const north = ground.room({ name: 'north', size: [512, 512, 1024] },
    { direction: Direction.North, width: 128, length: 0 })
  const east = north.room({ name: 'east', size: [512, 512, 192] },
    { direction: Direction.East, width: 128, length: 0, rise: 64, via: Transition.Step })
  map.connect(ground, east, { width: 128, via: Transition.Step })
  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('INSUFFICIENT_CLEARANCE')
  expect(error.detail).toMatchObject({ a: 'ground', b: 'east' })
})

test.each([Direction.North, Direction.East, Direction.South, Direction.West])(
  'a corridor may climb past the lower room\'s ceiling, facing %s',
  (direction) => {
    // 192 of rise between two 192-tall rooms: "b"'s floor sits exactly at
    // "a"'s ceiling, so the two rooms' interiors do not overlap in z at all.
    // A corridor's roof climbs with its floor, so this is an ordinary sloping
    // tube — it was rejected only while the roof stayed flat and the way
    // through was capped at "a"'s ceiling. seal.test.ts proves it is sealed
    // and that "b" is reachable; headroom.test.ts proves it stays 192 tall.
    const map = new CS2Map('t')
    const a = map.room({ name: 'a', size: [512, 512, 192] })
    a.room({ name: 'b', size: [512, 512, 192] },
      { direction, width: 128, length: 256, rise: 192 })
    const layout = solve(map.graph)
    const passage = layout.passages[0]!
    expect([passage.fromZ, passage.toZ]).toEqual([0, 192])
    expect([passage.fromCeilingZ, passage.toCeilingZ]).toEqual([192, 384])
  },
)

test('a corridor driving through a third room is an overlap', () => {
  // aSite east of mid, bSite west of mid: the only straight corridor between
  // them runs through mid. This is the mistake the spec's own first draft made.
  const map = new CS2Map('t')
  const mid = map.room({ name: 'mid', size: [512, 512, 192] })
  const aSite = mid.room({ name: 'aSite', size: [512, 512, 192] },
    { direction: Direction.East, width: 128, length: 512 })
  const bSite = mid.room({ name: 'bSite', size: [512, 512, 192] },
    { direction: Direction.West, width: 128, length: 512 })
  map.connect(aSite, bSite, { width: 128 })

  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('OVERLAP')
  expect(error.detail.through).toBe('mid')
})

test('two corridors crossing each other is an overlap', () => {
  // c and d hang off b's south wall either side of the a -> b corridor, so the
  // corridor between them runs straight across it. Neither room overlaps
  // anything; only the two corridors do, which nothing was checking.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 512 })
  const c = b.room({ name: 'c', size: [704, 512, 192] },
    { direction: Direction.South, width: 128, length: 0, offset: -416 })
  const d = b.room({ name: 'd', size: [704, 512, 192] },
    { direction: Direction.South, width: 128, length: 0, offset: 416 })
  map.connect(c, d, { width: 128 })

  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('OVERLAP')
  expect(error.detail.rooms).toEqual(['a', 'b'])
  expect(error.detail.crosses).toEqual(['c', 'd'])
})

test('an unroutable cross connection is rejected', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 1024 })
  const c = b.room({ name: 'c', size: [512, 512, 192] },
    { direction: Direction.East, width: 128, length: 1024 })
  map.connect(a, c, { width: 128 })
  expect(thrown(SolverError, () => solve(map.graph)).code).toBe('UNROUTABLE_CONNECTION')
})

test('a cross connection separated but with too little overlap is INSUFFICIENT_FACE_OVERLAP, not unroutable', () => {
  // a is at x[-256,256]; b sits north of it offset so it lands at x[192,704] -
  // only 64 units of x overlap, less than the requested corridor width. The
  // rooms *are* axis-separated (along y); only the overlap is too narrow, so
  // this must not be misreported as "neither flush nor separated".
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 64, length: 512, offset: 448 })
  map.connect(a, b, { width: 256 })
  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('INSUFFICIENT_FACE_OVERLAP')
  expect(error.detail.overlap).toBe(64)
})

test('a flush cross connection with a height difference and a ramp is a rise conflict', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, rise: 64, via: Transition.Step })
  map.connect(a, b, { width: 128 })
  expect(thrown(SolverError, () => solve(map.graph)).code).toBe('RISE_CONFLICT')
})

test('a stepped cross connection with a 128-unit rise is a rise conflict', () => {
  // The 128 units of height come in over a ramp with run to spare, so the
  // only thing left for the solver to object to is the *cross* edge trying to
  // step them in one go.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256, rise: 128, via: Transition.Ramp })
  map.connect(a, b, { width: 128, via: Transition.Step })
  expect(thrown(SolverError, () => solve(map.graph)).code).toBe('RISE_CONFLICT')
})

test('a stepped cross connection with a 64-unit rise is accepted', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, rise: 64, via: Transition.Step })
  map.connect(a, b, { width: 128, via: Transition.Step })
  expect(() => solve(map.graph)).not.toThrow()
})

test('a ramped cross connection with ample run for its rise is accepted', () => {
  const map = new CS2Map('t')
  const hub = map.room({ name: 'hub', size: [512, 512, 192] })
  const raised = hub.room({ name: 'raised', size: [512, 512, 192] },
    { direction: Direction.East, width: 128, length: 256, rise: 64 })
  map.connect(hub, raised, { width: 128 })
  expect(() => solve(map.graph)).not.toThrow()
})

// Transition.Step is one ledge however much run the connection has: the
// corridor floor stays level with the lower room and the whole rise happens
// at the higher room's face. Placement edges used to be exempt from the rule
// cross edges already applied, so a 300-unit step read as a valid route.
test.each([0, 256])('a placement step taller than a player is a rise conflict, length %i', (length) => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length, rise: 128, via: Transition.Step })
  expect(thrown(SolverError, () => solve(map.graph)).code).toBe('RISE_CONFLICT')
})

test('a placement step a player can climb is accepted', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, rise: 64, via: Transition.Step })
  expect(() => solve(map.graph)).not.toThrow()
})

test('the remediation for a rise with no run does not point at Transition.Step', () => {
  // Suggesting Step here used to send authors straight into a 300-unit ledge
  // that the geometry could not seal and no player could climb.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, rise: 300 })
  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('SLOPE_WITHOUT_RUN')
  expect(error.message).not.toContain('Step')
  expect(error.message).toContain('length of at least 300 units')
})

test('a layout that runs past the edge of the world is rejected, naming the room and axis', () => {
  // Rooms are placed relative to their parent, so nothing stops a chain of
  // connections from walking clean off the far side of Source's world.
  const map = new CS2Map('t')
  let room = map.room({ name: 'r0', size: [1024, 1024, 192] })
  for (let i = 1; i < 70; i++) {
    room = room.room({ name: `r${i}`, size: [1024, 1024, 192] },
      { direction: Direction.East, width: 128, length: 0 })
  }
  const error = thrown(SolverError, () => solve(map.graph))
  expect(error.code).toBe('OUT_OF_BOUNDS')
  expect(error.detail.axis).toBe('x')
  expect(error.message).toMatch(/room "r\d+"/)
  expect(Math.abs(error.detail.value as number)).toBeGreaterThan(16384)
})

test('a layout that fits inside the world is not rejected', () => {
  const map = new CS2Map('t')
  let room = map.room({ name: 'r0', size: [1024, 1024, 192] })
  for (let i = 1; i < 16; i++) {
    room = room.room({ name: `r${i}`, size: [1024, 1024, 192] },
      { direction: Direction.East, width: 128, length: 0 })
  }
  expect(() => solve(map.graph)).not.toThrow()
})
