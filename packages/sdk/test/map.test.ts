import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { Align, Bombsite, Direction, Team, Transition } from '../src/types'
import type { Vec3 } from '../src/types'
import { AuthoringError } from '../src/errors'
import { thrown } from './support/errors'

test('anchor plus children builds a placement tree', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [256, 256, 192] },
    { direction: Direction.North, width: 128, length: 256 })

  expect(map.graph.rooms.map((r) => r.name)).toEqual(['a', 'b'])
  expect(map.graph.placements).toHaveLength(1)
  expect(map.graph.placements[0]).toMatchObject({ parent: a.id, child: b.id })
  // defaults are materialised at authoring time, not left undefined
  expect(map.graph.placements[0]!.connection).toMatchObject({
    offset: 0, rise: 0, via: Transition.Ramp, height: null,
  })
})

test('a second anchor is rejected', () => {
  const map = new CS2Map('de_test')
  map.room({ name: 'a', size: [512, 512, 192] })
  const error = thrown(AuthoringError,
    () => map.room({ name: 'b', size: [512, 512, 192] }))
  expect(error.code).toBe('DUPLICATE_ANCHOR')
})

test('duplicate room names are rejected', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const error = thrown(AuthoringError, () => a.room({ name: 'a', size: [256, 256, 192] },
    { direction: Direction.North, width: 128, length: 0 }))
  expect(error.code).toBe('DUPLICATE_ROOM_NAME')
})

test('diagonal directions are rejected at runtime as well as by types', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const error = thrown(AuthoringError, () => a.room({ name: 'b', size: [256, 256, 192] },
    // deliberately bypassing the Cardinal type to prove the guard exists
    { direction: Direction.NorthEast as never, width: 128, length: 0 }))
  expect(error.code).toBe('DIAGONAL_CONNECTION')
})

test('a rejected diagonal leaves no partial room in the graph', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  expect(() => a.room({ name: 'b', size: [256, 256, 192] },
    { direction: Direction.NorthEast as never, width: 128, length: 0 })).toThrow()
  expect(map.graph.rooms).toHaveLength(1)
  expect(map.graph.placements).toHaveLength(0)
})

// A non-positive side inverts the room's bounds, and subtractIntervals reads
// an inverted span as "nothing left to emit" — so the room came out with its
// two slabs and none of its four walls, and the map leaked. It has to be
// refused where the size is authored.
const BAD_SIZES: Vec3[] = [
  [512, 512, -192], [512, 0, 192], [-1, 512, 192], [512, 512, NaN],
  [512, 512, Infinity],
]

test('a room with a non-positive or non-finite side is rejected', () => {
  for (const size of BAD_SIZES) {
    const map = new CS2Map('de_test')
    const error = thrown(AuthoringError, () => map.room({ name: 'a', size }))
    expect(error.code).toBe('INVALID_ROOM_SIZE')
    expect(error.detail.size).toEqual(size)
    // Rejected on the way in, so nothing half-made is left in the graph.
    expect(map.graph.rooms).toHaveLength(0)
  }
})

test('a child room is held to the same rule as the anchor', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const error = thrown(AuthoringError, () => a.room({ name: 'b', size: [512, 512, 0] },
    { direction: Direction.North, width: 128, length: 256 }))
  expect(error.code).toBe('INVALID_ROOM_SIZE')
  expect(map.graph.rooms).toHaveLength(1)
  expect(map.graph.placements).toHaveLength(0)
})

// height 0 is not "no height", it is a doorway with no clear height at all:
// the room emits a floor slab, no side walls and no ceiling, and the lintel
// above the opening then seals the doorway shut. Rejecting it is the only
// coherent answer.
test.each([0, -64])('a connection height of %i is rejected on both edge kinds', (height) => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256 })

  for (const attempt of [
    () => a.room({ name: 'c', size: [512, 512, 192] },
      { direction: Direction.East, width: 128, length: 256, height }),
    () => map.connect(a, b, { width: 128, height }),
  ]) {
    const error = thrown(AuthoringError, attempt)
    expect(error.code).toBe('NEGATIVE_HEIGHT')
    expect(error.detail.height).toBe(height)
  }
})

test('cross connections are recorded separately from placements', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  const b = a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256 })
  map.connect(a, b, { width: 96 })

  expect(map.graph.crossEdges).toEqual([
    { a: a.id, b: b.id, width: 96, height: null, via: Transition.Ramp },
  ])
})

test('gameplay helpers record requests with defaults applied', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.spawns(Team.T, { count: 10, align: Align.Bottom, facing: Direction.North })
  a.bombsite(Bombsite.A)
  a.entity('light_omni2', { at: [0, 0, 128] })

  expect(a.node.spawns[0]).toMatchObject({ team: Team.T, count: 10, spacing: 128 })
  expect(a.node.bombsites[0]).toMatchObject({ site: Bombsite.A, size: null })
  expect(a.node.entities[0]).toMatchObject({ classname: 'light_omni2' })
})

test('a Room reports the name and size it was created with', () => {
  // Both are on the published Room type (index.ts re-exports it), so they are
  // API whether or not anything in this repo reads them.
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 256, 192] })
  expect(a.name).toBe('a')
  expect(a.size).toEqual([512, 256, 192])
})
