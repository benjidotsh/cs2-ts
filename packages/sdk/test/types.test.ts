import { expect, test } from 'bun:test'
import { Direction, aabbsOverlap, directionYaw, isCardinal } from '../src/types'
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
  const a = { min: [0, 0, 0] as const, max: [10, 10, 10] as const }
  const b = { min: [10, 0, 0] as const, max: [20, 10, 10] as const }
  const c = { min: [9, 0, 0] as const, max: [20, 10, 10] as const }
  expect(aabbsOverlap({ ...a }, { ...b })).toBe(false)
  expect(aabbsOverlap({ ...a }, { ...c })).toBe(true)
})

test('solver errors carry a machine-readable code', () => {
  const err = new SolverError('OVERLAP', 'rooms overlap', { rooms: ['a', 'b'] })
  expect(err.code).toBe('OVERLAP')
  expect(err.detail).toEqual({ rooms: ['a', 'b'] })
  expect(err).toBeInstanceOf(Error)
})
