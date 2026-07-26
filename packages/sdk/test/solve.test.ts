import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { Direction, Transition } from '../src/types'
import { SolverError } from '../src/errors'

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

  try {
    solve(map.graph)
    throw new Error('expected solve to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(SolverError)
    expect((e as SolverError).code).toBe('OVERLAP')
    expect(JSON.stringify((e as SolverError).detail)).toContain('a')
  }
})

test('a connection wider than the shared face is rejected', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [256, 256, 192] })
  expect(() => {
    a.room({ name: 'b', size: [256, 256, 192] },
      { direction: Direction.North, width: 512, length: 0 })
    solve(map.graph)
  }).toThrow(/INSUFFICIENT_FACE_OVERLAP|face overlap/)
})

test('a rise with no run is rejected', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 0, rise: 64 })
  try {
    solve(map.graph)
    throw new Error('expected solve to throw')
  } catch (e) {
    expect((e as SolverError).code).toBe('SLOPE_WITHOUT_RUN')
  }
})

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

  try {
    solve(map.graph)
    throw new Error('expected solve to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(SolverError)
    expect((e as SolverError).code).toBe('OVERLAP')
    expect((e as SolverError).detail.through).toBe('mid')
  }
})

test('an unroutable cross connection is rejected', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 1024 })
  const c = b.room({ name: 'c', size: [512, 512, 192] },
    { direction: Direction.East, width: 128, length: 1024 })
  map.connect(a, c, { width: 128 })
  try {
    solve(map.graph)
    throw new Error('expected solve to throw')
  } catch (e) {
    expect((e as SolverError).code).toBe('UNROUTABLE_CONNECTION')
  }
})
