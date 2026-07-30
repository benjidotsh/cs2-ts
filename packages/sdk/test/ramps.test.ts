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
  const wedges = solids.filter((s) => s.kind === 'wedge').filter((s) => !s.inverted)
  expect(wedges).toHaveLength(1)
  const w = wedges[0]!
  expect(w.rise).toBe(Direction.North)
  expect(w.min[2]).toBe(0)
  expect(w.max[2]).toBe(64)
})

test('the ceiling over a ramp climbs with it, on the same slope', () => {
  // Both rooms are 192 tall, so the clear height is 192: the roof runs from
  // 192 at the low end to 256 at the high one, keeping 192 units of headroom
  // the whole way rather than pinching down to 128 at the top.
  const solids = toSolids(rampMap(Transition.Ramp))
  const ceilings = solids.filter((s) => s.kind === 'wedge').filter((s) => s.inverted)
  expect(ceilings).toHaveLength(1)
  const c = ceilings[0]!
  expect(c.rise).toBe(Direction.North)
  expect([c.min[2], c.max[2]]).toEqual([192, 256])
  // Same footprint and same rise as the ramp under it, and the same 64 units
  // of climb — that is what makes the clearance constant.
  const ramp = solids.find((s) => s.kind === 'wedge' && !s.inverted)!
  expect([c.min[0], c.min[1]]).toEqual([ramp.min[0], ramp.min[1]])
  expect([c.max[0], c.max[1]]).toEqual([ramp.max[0], ramp.max[1]])
  expect(c.max[2]! - c.min[2]!).toBe(ramp.max[2]! - ramp.min[2]!)
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
  'a ramp emits a wedge rising toward the higher room, direction %s',
  (direction) => {
    const map = new CS2Map('t')
    const a = map.room({ name: 'a', size: [512, 512, 192] })
    a.room({ name: 'b', size: [512, 512, 192] },
      { direction, width: 128, length: 256, rise: 64, via: Transition.Ramp })
    const solids = toSolids(solve(map.graph))
    const wedges = solids.filter((s) => s.kind === 'wedge').filter((s) => !s.inverted)
    expect(wedges).toHaveLength(1)
    expect(wedges[0]!.rise).toBe(direction)

    // The ceiling has to climb the same way, or the corridor pinches shut at
    // whichever end the roof failed to follow the floor to.
    const ceilings = solids.filter((s) => s.kind === 'wedge').filter((s) => s.inverted)
    expect(ceilings).toHaveLength(1)
    expect(ceilings[0]!.rise).toBe(direction)
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
  // No sloped *floor*: a step is a deliberate ledge. The roof above it still
  // climbs to meet the higher room's opening at that room's own height.
  expect(solids.filter((s) => s.kind === 'wedge' && !s.inverted)).toHaveLength(0)

  // One flat slab at the lower room's level, spanning the whole corridor.
  const slab = solids.filter(
    (s) => s.kind === 'box' && s.min[1]! === 256 && s.max[1]! === 512 && s.max[2]! <= 64)
  expect(slab).toHaveLength(1)
  expect(slab[0]!.min[2]).toBe(-16)
  expect(slab[0]!.max[2]).toBe(0)

  // And the ledge: the higher room's wall reaches down from its own floor to
  // the corridor's, closing the doorway-wide gap under its floor slab. The
  // wall itself only spans floorZ..ceilingZ, so without this the step opens
  // into the void beneath the room.
  const sill = solids.filter(
    (s) => s.kind === 'box' && s.min[1]! === 496 && s.max[1]! === 512 &&
      s.min[2]! === 0 && s.max[2]! === 64)
  expect(sill).toHaveLength(1)
  expect([sill[0]!.min[0], sill[0]!.max[0]]).toEqual([-64, 64])
})

test('level corridors emit no wedge', () => {
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 192] },
    { direction: Direction.North, width: 128, length: 256 })
  expect(toSolids(solve(map.graph)).filter((s) => s.kind === 'wedge')).toHaveLength(0)
})

test('a level corridor between rooms of different heights keeps a flat roof', () => {
  // Nothing climbs, so nothing about the ceiling may slope either — the roof
  // sits at the shorter room's height, flat, exactly as it always has.
  const map = new CS2Map('t')
  const a = map.room({ name: 'a', size: [512, 512, 192] })
  a.room({ name: 'b', size: [512, 512, 320] },
    { direction: Direction.North, width: 128, length: 256 })
  const solids = toSolids(solve(map.graph))
  expect(solids.filter((s) => s.kind === 'wedge')).toHaveLength(0)
  const roof = solids.find(
    (s) => s.min[1]! === 256 && s.max[1]! === 512 && s.min[2]! === 192)!
  expect([roof.min[2], roof.max[2]]).toEqual([192, 208])
})
