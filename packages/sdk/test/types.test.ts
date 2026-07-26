import { expect, test } from 'bun:test'
import { Direction, directionYaw, isCardinal, type Vec3 } from '../src/types'
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
