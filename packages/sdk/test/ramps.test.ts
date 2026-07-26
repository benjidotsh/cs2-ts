import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { solve } from '../src/solve'
import { toSolids } from '../src/solids'
import { Direction, Transition } from '../src/types'

function rampMap(via: Transition) {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256, rise: 64, via })
  return solve(map.graph)
}

test('a ramp emits a wedge rising toward the higher room', () => {
  const solids = toSolids(rampMap(Transition.Ramp))
  const wedges = solids.filter((s) => s.kind === 'wedge')
  expect(wedges).toHaveLength(1)
  const w = wedges[0]!
  expect(w.kind).toBe('wedge')
  if (w.kind !== 'wedge') throw new Error('unreachable')
  expect(w.rise).toBe(Direction.North)
  expect(w.min[2]).toBe(0)
  expect(w.max[2]).toBe(64)
})

test('stairs emit one box per 8-unit riser', () => {
  const solids = toSolids(rampMap(Transition.Stairs))
  const steps = solids.filter(
    (s) => s.kind === 'box' && s.min[1]! >= 256 && s.max[1]! <= 512 && s.max[2]! <= 64)
  expect(steps.length).toBe(8)
  const tops = steps.map((s) => s.max[2]).sort((a, b) => a! - b!)
  expect(tops).toEqual([8, 16, 24, 32, 40, 48, 56, 64])
})

test('a step transition keeps a flat slab', () => {
  const solids = toSolids(rampMap(Transition.Step))
  expect(solids.filter((s) => s.kind === 'wedge')).toHaveLength(0)
})

test('level corridors emit no wedge', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256 })
  expect(toSolids(solve(map.graph)).filter((s) => s.kind === 'wedge')).toHaveLength(0)
})
