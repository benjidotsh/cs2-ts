import { expect, test } from 'bun:test'
import { Direction, aabbsOverlap, directionYaw, isCardinal, type Aabb, type Vec3 } from '../src/types'
import { SolverError } from '../src/errors'

test('cardinals are recognised, diagonals are not', () => {
  expect(isCardinal(Direction.North)).toBe(true)
  expect(isCardinal(Direction.West)).toBe(true)
  expect(isCardinal(Direction.NorthEast)).toBe(false)
})

test('direction yaw follows Source conventions', () => {
  expect(directionYaw(Direction.East)).toBe(0)
  expect(directionYaw(Direction.North)).toBe(90)
  expect(directionYaw(Direction.West)).toBe(180)
  expect(directionYaw(Direction.South)).toBe(270)
  expect(directionYaw(Direction.NorthEast)).toBe(45)
})

test('touching boxes do not count as overlapping', () => {
  // Vec3 is a MUTABLE tuple on purpose — the solver and solids lowering both
  // build vectors by index assignment. Do not use `as const` here.
  const a: Aabb = { min: [0, 0, 0], max: [10, 10, 10] }
  const b: Aabb = { min: [10, 0, 0], max: [20, 10, 10] }
  const c: Aabb = { min: [9, 0, 0], max: [20, 10, 10] }
  expect(aabbsOverlap(a, b)).toBe(false)
  expect(aabbsOverlap(a, c)).toBe(true)
})

test('solver errors carry a machine-readable code', () => {
  const err = new SolverError('OVERLAP', 'rooms overlap', { rooms: ['a', 'b'] })
  expect(err.code).toBe('OVERLAP')
  expect(err.detail).toEqual({ rooms: ['a', 'b'] })
  expect(err).toBeInstanceOf(Error)
})

test('vectors are mutable by index, which the solver depends on', () => {
  const v: Vec3 = [0, 0, 0]
  v[1] = 42
  expect(v).toEqual([0, 42, 0])
})
