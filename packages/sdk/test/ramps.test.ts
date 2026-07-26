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

// Physically, whichever cardinal a connection's `direction` names always
// points from the parent room toward the child room — regardless of which
// axis end that direction happens to sit at (North/East place the child at
// bounds.max; South/West place it at bounds.min). So with a positive rise
// (child higher than parent), the wedge must rise in that same direction in
// all four cases. Under the pre-fix formula (`toZ > fromZ` alone, ignoring
// which physical end `from` occupies), North and East happen to come out
// right by coincidence — only South and West expose the sign error.
test.each([Direction.North, Direction.East, Direction.South, Direction.West])(
  'a ramp emits a wedge rising toward the higher room, direction %i',
  (direction) => {
    const map = new CS2Map('t')
    const a = map.room({ name: 'a', size: [512, 512, 192] })
    a.room({ name: 'b', size: [512, 512, 192] },
      { direction, width: 128, length: 256, rise: 64, via: Transition.Ramp })
    const solids = toSolids(solve(map.graph))
    const wedges = solids.filter((s) => s.kind === 'wedge')
    expect(wedges).toHaveLength(1)
    const w = wedges[0]!
    if (w.kind !== 'wedge') throw new Error('unreachable')
    expect(w.rise).toBe(direction)
  },
)

test('stairs emit one box per 8-unit riser', () => {
  const solids = toSolids(rampMap(Transition.Stairs))
  const steps = solids.filter(
    (s) => s.kind === 'box' && s.min[1]! >= 256 && s.max[1]! <= 512 && s.max[2]! <= 64)
  expect(steps.length).toBe(8)
  const tops = steps.map((s) => s.max[2]).sort((a, b) => a! - b!)
  expect(tops).toEqual([8, 16, 24, 32, 40, 48, 56, 64])
})

test('stairs land exactly on the upper floor when the rise is not a multiple of 8', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256, rise: 17, via: Transition.Stairs })
  const solids = toSolids(solve(map.graph))
  const steps = solids.filter(
    (s) => s.kind === 'box' && s.min[1]! >= 256 && s.max[1]! <= 512 && s.min[2]! === -16)
  expect(steps.length).toBe(3) // ceil(17 / 8)
  const top = Math.max(...steps.map((s) => s.max[2]!))
  // Not 24 (3 * 8): an unclamped final riser would overshoot the upper
  // room's floor by 7 units, leaving a floating ledge above it.
  expect(top).toBe(17)
})

test('a step transition keeps a flat slab, not a stair stack or a slope', () => {
  const solids = toSolids(rampMap(Transition.Step))
  expect(solids.filter((s) => s.kind === 'wedge')).toHaveLength(0)
  const floorish = solids.filter(
    (s) => s.kind === 'box' && s.min[1]! >= 256 && s.max[1]! <= 512 && s.max[2]! <= 64)
  expect(floorish).toHaveLength(1)
  expect(floorish[0]!.min[2]).toBe(-16)
  expect(floorish[0]!.max[2]).toBe(0)
})

test('level corridors emit no wedge', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256 })
  expect(toSolids(solve(map.graph)).filter((s) => s.kind === 'wedge')).toHaveLength(0)
})
