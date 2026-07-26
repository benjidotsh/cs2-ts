import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { Align, Bombsite, Direction, Team, Transition } from '../src/types'
import { AuthoringError } from '../src/errors'

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
  try {
    map.room({ name: 'b', size: [512, 512, 192] })
    throw new Error('expected map.room to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(AuthoringError)
    expect((e as AuthoringError).code).toBe('DUPLICATE_ANCHOR')
  }
})

test('duplicate room names are rejected', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  try {
    a.room({ name: 'a', size: [256, 256, 192] },
      { direction: Direction.North, width: 128, length: 0 })
    throw new Error('expected a.room to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(AuthoringError)
    expect((e as AuthoringError).code).toBe('DUPLICATE_ROOM_NAME')
  }
})

test('diagonal directions are rejected at runtime as well as by types', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  try {
    a.room({ name: 'b', size: [256, 256, 192] },
      // deliberately bypassing the Cardinal type to prove the guard exists
      { direction: Direction.NorthEast as never, width: 128, length: 0 })
    throw new Error('expected a.room to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(AuthoringError)
    expect((e as AuthoringError).code).toBe('DIAGONAL_CONNECTION')
  }
})

test('a rejected diagonal leaves no partial room in the graph', () => {
  const map = new CS2Map('de_test')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  expect(() => a.room({ name: 'b', size: [256, 256, 192] },
    { direction: Direction.NorthEast as never, width: 128, length: 0 })).toThrow()
  expect(map.graph.rooms).toHaveLength(1)
  expect(map.graph.placements).toHaveLength(0)
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
  a.entity('light_omni', { at: [0, 0, 128] })

  expect(a.node.spawns[0]).toMatchObject({ team: Team.T, count: 10, spacing: 128 })
  expect(a.node.bombsites[0]).toMatchObject({ site: Bombsite.A, size: null })
  expect(a.node.entities[0]).toMatchObject({ classname: 'light_omni' })
})
