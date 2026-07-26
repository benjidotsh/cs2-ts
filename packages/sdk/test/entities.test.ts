import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { layoutEntities, resolvePlacement } from '../src/entities'
import { Align, Bombsite, Direction, Surface, Team, directionYaw } from '../src/types'
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

test('facing values that used to collide with the old 0-7 enum range now pass through as literal degrees', () => {
  // Previously ambiguous under the numeric-enum encoding: `5` used to mean
  // `Direction.SouthWest`, `-90` fell into the same integer check and (once)
  // returned `undefined`, and `0` used to mean `Direction.North`. String
  // enums remove the ambiguity outright: any `number` is always a literal yaw.
  expect(resolvePlacement(room, { facing: 5 }).yaw).toBe(5)
  expect(resolvePlacement(room, { facing: -90 }).yaw).toBe(-90)
  expect(resolvePlacement(room, { facing: 0 }).yaw).toBe(0)
  expect(resolvePlacement(room, { facing: 3.5 }).yaw).toBe(3.5)
  expect(resolvePlacement(room, { facing: 359.9 }).yaw).toBe(359.9)
})

test.each(Object.values(Direction))('every Direction member resolves through directionYaw: %s', (direction) => {
  expect(resolvePlacement(room, { facing: direction }).yaw).toBe(directionYaw(direction))
})

test('wall alignment respects facing-the-wall-from-inside handedness', () => {
  // Facing each wall from inside the room: North faces +Y (right=east),
  // South faces -Y (right=west), East faces +X (right=south), West faces
  // -X (right=north). Align.Left is therefore the opposite of "right" above.
  expect(resolvePlacement(room, { surface: Surface.North, align: Align.Left }).origin)
    .toEqual([-512, 256, 96])
  expect(resolvePlacement(room, { surface: Surface.South, align: Align.Left }).origin)
    .toEqual([512, -256, 96])
  expect(resolvePlacement(room, { surface: Surface.East, align: Align.Left }).origin)
    .toEqual([512, 256, 96])
  expect(resolvePlacement(room, { surface: Surface.West, align: Align.Left }).origin)
    .toEqual([-512, -256, 96])
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

test('an edge-anchored grid that overflows the room is an error', () => {
  // 1024x768 room, y bounds [-384, 384]. Anchored at Align.Bottom, a 4x3
  // grid at the default 128u spacing spans y:[-512,-256] — 128 units of
  // that grid sit south of the room's own south wall (y=-384). The old
  // check compared grid size against room *size* and missed this because
  // it never looked at where the anchor actually sat.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 768, 192] })
  a.spawns(Team.T, { count: 10, align: Align.Bottom })
  expect(() => layoutEntities(solve(map.graph), map.graph)).toThrow(AuthoringError)
})

test('the same edge-anchored grid fits once shifted back inside the room', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [1024, 768, 192] })
  a.spawns(Team.T, { count: 10, align: Align.Bottom, at: [0, 192, 0] })
  expect(() => layoutEntities(solve(map.graph), map.graph)).not.toThrow()
})

test('a grid that exactly fits the room is not an error', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [256, 256, 192] })
  a.spawns(Team.CT, { count: 4, spacing: 256 })
  expect(() => layoutEntities(solve(map.graph), map.graph)).not.toThrow()
})

test('a non-positive spawn count is an error, not a silent no-op', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.spawns(Team.T, { count: 0 })
  expect(() => layoutEntities(solve(map.graph), map.graph)).toThrow(AuthoringError)

  const map2 = new CS2Map('t2')
  const b = map2.room({ name: 'b', size: [512, 512, 192] })
  b.spawns(Team.T, { count: -1 })
  expect(() => layoutEntities(solve(map2.graph), map2.graph)).toThrow(AuthoringError)
})

test('a bombsite defaults to the room footprint', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.bombsite(Bombsite.A)
  const ents = layoutEntities(solve(map.graph), map.graph)
  const site = ents.find((e) => e.classname === 'func_bomb_target')!
  expect(site.properties.bomb_site).toBe('A')
  expect(site.origin).toEqual([0, 0, 0])
  expect(site.properties['mins.x']).toBe(-256)
  expect(site.properties['mins.y']).toBe(-256)
  expect(site.properties['mins.z']).toBe(0)
  expect(site.properties['maxs.x']).toBe(256)
  expect(site.properties['maxs.y']).toBe(256)
  expect(site.properties['maxs.z']).toBe(128)
})

test('a bombsite honors an explicit size', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.bombsite(Bombsite.B, { size: [100, 200, 64] })
  const ents = layoutEntities(solve(map.graph), map.graph)
  const site = ents.find((e) => e.classname === 'func_bomb_target')!
  expect(site.properties.bomb_site).toBe('B')
  expect(site.properties['mins.x']).toBe(-50)
  expect(site.properties['mins.y']).toBe(-100)
  expect(site.properties['mins.z']).toBe(0)
  expect(site.properties['maxs.x']).toBe(50)
  expect(site.properties['maxs.y']).toBe(100)
  expect(site.properties['maxs.z']).toBe(64)
})
