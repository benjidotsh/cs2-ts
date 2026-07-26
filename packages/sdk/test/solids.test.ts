import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { subtractIntervals, toSolids } from '../src/solids'
import { Direction } from '../src/types'

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

test('every emitted solid has positive volume', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 768, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 192, length: 256 })
  for (const s of toSolids(solve(map.graph))) {
    expect(s.max[0]! - s.min[0]!).toBeGreaterThan(0)
    expect(s.max[1]! - s.min[1]!).toBeGreaterThan(0)
    expect(s.max[2]! - s.min[2]!).toBeGreaterThan(0)
  }
})
