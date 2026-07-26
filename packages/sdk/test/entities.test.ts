import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { layoutEntities, resolvePlacement } from '../src/entities'
import { Align, Bombsite, Direction, Surface, Team } from '../src/types'
import { AuthoringError } from '../src/errors'

const room = {
  id: 0, name: 'r', floorZ: 0,
  bounds: { min: [-512, -256, 0] as [number, number, number],
            max: [512, 256, 192] as [number, number, number] },
}

test('floor alignment reads as a top-down map view', () => {
  expect(resolvePlacement(room, {}).origin).toEqual([0, 0, 0])
  expect(resolvePlacement(room, { align: Align.Top }).origin)
    .toEqual([0, 256, 0])
  expect(resolvePlacement(room, { align: Align.Bottom }).origin)
    .toEqual([0, -256, 0])
  expect(resolvePlacement(room, { align: Align.Right }).origin)
    .toEqual([512, 0, 0])
  expect(resolvePlacement(room, { align: Align.BottomLeft }).origin)
    .toEqual([-512, -256, 0])
})

test('ceiling alignment uses the ceiling plane', () => {
  expect(resolvePlacement(room, { surface: Surface.Ceiling }).origin)
    .toEqual([0, 0, 192])
})

test('offsets are applied in world axes after anchoring', () => {
  expect(resolvePlacement(room, { align: Align.Top, at: [10, -20, 30] }).origin)
    .toEqual([10, 236, 30])
})

test('facing accepts an enum or a raw yaw', () => {
  expect(resolvePlacement(room, { facing: Direction.North }).yaw).toBe(90)
  expect(resolvePlacement(room, { facing: 33 }).yaw).toBe(33)
})

test('spawns form a compact square-ish grid at the anchor', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 1024, 192] })
  a.spawns(Team.T, { count: 10, facing: Direction.North })
  const ents = layoutEntities(solve(map.graph), map.graph)
  const spawns = ents.filter((e) => e.classname === 'info_player_terrorist')

  expect(spawns).toHaveLength(10)
  expect(new Set(spawns.map((s) => s.origin[0])).size).toBe(4) // ceil(sqrt(10))
  for (const s of spawns) expect(s.angles).toEqual([0, 90, 0])
})

test('a grid too large for its room is an error, not a silent clip', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [128, 128, 192] })
  a.spawns(Team.CT, { count: 20 })
  expect(() => layoutEntities(solve(map.graph), map.graph)).toThrow(AuthoringError)
})

test('a bombsite defaults to the room footprint', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.bombsite(Bombsite.A)
  const ents = layoutEntities(solve(map.graph), map.graph)
  const site = ents.find((e) => e.classname === 'func_bomb_target')!
  expect(site.properties.bomb_site).toBe('A')
  expect(site.origin).toEqual([0, 0, 0])
})
