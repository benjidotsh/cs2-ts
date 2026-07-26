import { MATERIALS, SLAB_THICKNESS, WALL_THICKNESS } from './defaults'
import type { Layout, Passage, PlacedRoom } from './solve'
import type { BoxSolid, Solid, Vec3 } from './types'

export interface Interval { lo: number; hi: number }

/** Removes `holes` from `span`, merging overlaps. Zero-length results dropped. */
export function subtractIntervals(span: Interval, holes: Interval[]): Interval[] {
  const clipped = holes
    .map((h) => ({ lo: Math.max(h.lo, span.lo), hi: Math.min(h.hi, span.hi) }))
    .filter((h) => h.hi > h.lo)
    .sort((a, b) => a.lo - b.lo)

  const out: Interval[] = []
  let cursor = span.lo
  for (const hole of clipped) {
    if (hole.lo > cursor) out.push({ lo: cursor, hi: hole.lo })
    cursor = Math.max(cursor, hole.hi)
  }
  if (cursor < span.hi) out.push({ lo: cursor, hi: span.hi })
  return out
}

const box = (min: Vec3, max: Vec3, material: string): BoxSolid =>
  ({ kind: 'box', min, max, material })

/** An opening in one wall of one room: a horizontal span and a height. */
interface Opening {
  lo: number
  hi: number
  top: number
}

export function toSolids(layout: Layout): Solid[] {
  const solids: Solid[] = []
  const openings = new Map<string, Opening[]>()
  const key = (roomId: number, side: string) => `${roomId}:${side}`

  const addOpening = (roomId: number, side: string, opening: Opening) => {
    const list = openings.get(key(roomId, side))
    if (list) list.push(opening)
    else openings.set(key(roomId, side), [opening])
  }

  // Register the holes each passage punches, then emit corridor geometry.
  for (const passage of layout.passages) {
    const from = layout.rooms.find((r) => r.id === passage.from)!
    const to = layout.rooms.find((r) => r.id === passage.to)!
    const other: 0 | 1 = passage.axis === 0 ? 1 : 0
    const lo = passage.bounds.min[other]!
    const hi = passage.bounds.max[other]!
    const top = passage.bounds.max[2]!

    addOpening(from.id, sideFacing(from, passage), { lo, hi, top })
    addOpening(to.id, sideFacing(to, passage), { lo, hi, top })

    if (passage.bounds.max[passage.axis]! > passage.bounds.min[passage.axis]!) {
      solids.push(...corridorSolids(passage))
    }
  }

  for (const room of layout.rooms) {
    solids.push(...roomSolids(room, openings))
  }

  return solids

  /**
   * Which wall of `room` the passage meets: 'minX' | 'maxX' | 'minY' | 'maxY'.
   * A passage always abuts exactly one of the room's two faces on its travel
   * axis — whichever room is "from" or "to" makes no difference — so a
   * single test serves both endpoints.
   */
  function sideFacing(room: PlacedRoom, passage: Passage): string {
    const axis = passage.axis
    const roomIsLower = passage.bounds.min[axis]! >= room.bounds.max[axis]!
    const label = axis === 0 ? 'X' : 'Y'
    return roomIsLower ? `max${label}` : `min${label}`
  }
}

function corridorSolids(passage: Passage): Solid[] {
  const { bounds, axis } = passage
  const other: 0 | 1 = axis === 0 ? 1 : 0
  const out: Solid[] = []

  const floorTop = Math.min(passage.fromZ, passage.toZ)
  const floorMin: Vec3 = [0, 0, floorTop - SLAB_THICKNESS]
  const floorMax: Vec3 = [0, 0, floorTop]
  for (const i of [0, 1] as const) {
    floorMin[i] = bounds.min[i]!
    floorMax[i] = bounds.max[i]!
  }
  out.push(box(floorMin, floorMax, MATERIALS.floor))

  // A corridor whose computed ceiling doesn't clear its own floor has no
  // meaningful side walls or ceiling to build; the floor slab still marks it.
  if (bounds.max[2]! > floorTop) {
    // Side walls run the length of the corridor, outside its width, inset by
    // a wall's thickness at each end so they sit between the two rooms' own
    // walls rather than inside them. A corridor exactly `2 * WALL_THICKNESS`
    // long needs none — the two rooms' walls already meet with no gap.
    for (const side of [-1, 1] as const) {
      const min: Vec3 = [0, 0, floorTop]
      const max: Vec3 = [0, 0, bounds.max[2]!]
      min[axis] = bounds.min[axis]! + WALL_THICKNESS
      max[axis] = bounds.max[axis]! - WALL_THICKNESS
      if (side === -1) {
        min[other] = bounds.min[other]! - WALL_THICKNESS
        max[other] = bounds.min[other]!
      } else {
        min[other] = bounds.max[other]!
        max[other] = bounds.max[other]! + WALL_THICKNESS
      }
      if (max[axis]! > min[axis]!) out.push(box(min, max, MATERIALS.wall))
    }

    const ceilMin: Vec3 = [0, 0, bounds.max[2]!]
    const ceilMax: Vec3 = [0, 0, bounds.max[2]! + SLAB_THICKNESS]
    for (const i of [0, 1] as const) {
      ceilMin[i] = bounds.min[i]!
      ceilMax[i] = bounds.max[i]!
    }
    out.push(box(ceilMin, ceilMax, MATERIALS.ceiling))
  }

  return out
}

function roomSolids(room: PlacedRoom, openings: Map<string, Opening[]>): Solid[] {
  const { bounds, floorZ } = room
  const ceilingZ = bounds.max[2]!
  const out: Solid[] = []

  out.push(box(
    [bounds.min[0]!, bounds.min[1]!, floorZ - SLAB_THICKNESS],
    [bounds.max[0]!, bounds.max[1]!, floorZ],
    MATERIALS.floor,
  ))
  out.push(box(
    [bounds.min[0]!, bounds.min[1]!, ceilingZ],
    [bounds.max[0]!, bounds.max[1]!, ceilingZ + SLAB_THICKNESS],
    MATERIALS.ceiling,
  ))

  const sides = [
    { side: 'minX', axis: 0 as const, at: bounds.min[0]!, outward: -1 as const },
    { side: 'maxX', axis: 0 as const, at: bounds.max[0]!, outward: 1 as const },
    { side: 'minY', axis: 1 as const, at: bounds.min[1]!, outward: -1 as const },
    { side: 'maxY', axis: 1 as const, at: bounds.max[1]!, outward: 1 as const },
  ]

  for (const { side, axis, at, outward } of sides) {
    const other: 0 | 1 = axis === 0 ? 1 : 0
    // The X-axis walls (running north-south) are widened to cover the corner
    // columns the Y-axis walls leave void; widening both pairs would double
    // that corner volume instead of filling it.
    const pad = axis === 0 ? WALL_THICKNESS : 0
    const span: Interval = { lo: bounds.min[other]! - pad, hi: bounds.max[other]! + pad }
    const holes = openings.get(`${room.id}:${side}`) ?? []

    const wallMinAxis = outward === -1 ? at - WALL_THICKNESS : at
    const wallMaxAxis = outward === -1 ? at : at + WALL_THICKNESS

    for (const piece of subtractIntervals(span, holes)) {
      const min: Vec3 = [0, 0, floorZ]
      const max: Vec3 = [0, 0, ceilingZ]
      min[axis] = wallMinAxis; max[axis] = wallMaxAxis
      min[other] = piece.lo; max[other] = piece.hi
      out.push(box(min, max, MATERIALS.wall))
    }

    // A lintel spans the gap above any opening that stops short of the ceiling.
    for (const hole of holes) {
      if (hole.top >= ceilingZ) continue
      const min: Vec3 = [0, 0, hole.top]
      const max: Vec3 = [0, 0, ceilingZ]
      min[axis] = wallMinAxis; max[axis] = wallMaxAxis
      min[other] = Math.max(hole.lo, span.lo)
      max[other] = Math.min(hole.hi, span.hi)
      if (max[other]! > min[other]!) out.push(box(min, max, MATERIALS.wall))
    }
  }

  return out
}
