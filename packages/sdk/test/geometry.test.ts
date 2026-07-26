import { expect, test } from 'bun:test'
import { aabbsOverlap, overlap1d } from '../src/geometry'
import type { Aabb } from '../src/types'

test('touching boxes do not count as overlapping', () => {
  // Vec3 is a MUTABLE tuple on purpose — the solver and solids lowering both
  // build vectors by index assignment. Do not use `as const` here.
  const a: Aabb = { min: [0, 0, 0], max: [10, 10, 10] }
  const b: Aabb = { min: [10, 0, 0], max: [20, 10, 10] }
  const c: Aabb = { min: [9, 0, 0], max: [20, 10, 10] }
  expect(aabbsOverlap(a, b)).toBe(false)
  expect(aabbsOverlap(a, c)).toBe(true)
})

test('touching intervals have non-positive size, matching aabbsOverlap', () => {
  expect(overlap1d(0, 10, 4, 6)).toEqual({ lo: 4, hi: 6, size: 2 })
  expect(overlap1d(0, 10, 10, 20)).toEqual({ lo: 10, hi: 10, size: 0 })
  expect(overlap1d(0, 10, 14, 20).size).toBeLessThan(0)
})
