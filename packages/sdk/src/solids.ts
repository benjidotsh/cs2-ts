import { MATERIALS, SLAB_THICKNESS, WALL_THICKNESS } from './defaults'
import type { Layout, Passage, PlacedRoom } from './solve'
import {
  Direction, Transition,
  type BoxSolid, type Cardinal, type Solid, type Vec3, type WedgeSolid,
} from './types'

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

/** An opening in one wall of one room: a horizontal span and a height range. */
interface Opening {
  lo: number
  hi: number
  /**
   * Floor level of whatever the opening leads onto, measured at this room's
   * own face. Equal to the room's `floorZ` for everything that climbs to meet
   * the room where it stands; lower than it when the way through starts below
   * the room's floor, which is what the sill in `roomSolids` then fills in.
   */
  bottom: number
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

    // Transition.Step lays one flat floor at the lower of the two rooms'
    // floors, so at the *higher* room's face the way through starts a whole
    // rise below that room's own floor — the wall there has to reach down to
    // meet it. Ramps and stairs climb to each room's floor at its own face,
    // so their openings start level with it.
    const lowZ = Math.min(passage.fromZ, passage.toZ)
    const bottomOf = (room: PlacedRoom) =>
      passage.via === Transition.Step ? lowZ : room.floorZ

    // Each opening is cut to the corridor's own cross-section where it meets
    // that room, which on anything that climbs is higher at the top end than
    // at the bottom. The two are equal on a level corridor and on a flush
    // doorway, which has no roof of its own.
    addOpening(from.id, sideFacing(from, passage),
      { lo, hi, top: passage.fromCeilingZ, bottom: bottomOf(from) })
    addOpening(to.id, sideFacing(to, passage),
      { lo, hi, top: passage.toCeilingZ, bottom: bottomOf(to) })

    if (passage.bounds.max[passage.axis]! > passage.bounds.min[passage.axis]!) {
      // Which physical end (bounds.min or bounds.max along the travel axis)
      // "from" occupies isn't recorded on Passage — direction/sign live on
      // the connection, not here — so it's derived the same way sideFacing()
      // derives it below, and passed down since corridorSolids only sees the
      // passage.
      const fromAtMinEnd = passage.bounds.min[passage.axis]! >= from.bounds.max[passage.axis]!
      solids.push(...corridorSolids(passage, fromAtMinEnd))
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

/**
 * `fromAtMinEnd` says whether `passage.from` sits at `bounds.min[axis]` (vs.
 * `bounds.max[axis]`) — needed to tell which physical end a rise climbs
 * toward, since that depends on the connection's direction/sign, not just on
 * whether `toZ` is numerically greater than `fromZ`.
 */
function corridorSolids(passage: Passage, fromAtMinEnd: boolean): Solid[] {
  const { bounds, axis } = passage
  const other: 0 | 1 = axis === 0 ? 1 : 0
  const out: Solid[] = []

  const lowZ = Math.min(passage.fromZ, passage.toZ)
  const highZ = Math.max(passage.fromZ, passage.toZ)
  const risesTowardMax = fromAtMinEnd === (passage.toZ > passage.fromZ)
  const axisMin = bounds.min[axis]!
  const axisMax = bounds.max[axis]!

  if (highZ === lowZ || passage.via === Transition.Step) {
    // Level corridors, and Transition.Step regardless of rise, are a flat
    // slab at the lower end — Step is a deliberate ledge, not a slope.
    const floorMin: Vec3 = [0, 0, lowZ - SLAB_THICKNESS]
    const floorMax: Vec3 = [0, 0, lowZ]
    for (const i of [0, 1] as const) {
      floorMin[i] = bounds.min[i]!
      floorMax[i] = bounds.max[i]!
    }
    out.push(box(floorMin, floorMax, MATERIALS.floor))
  } else if (passage.via === Transition.Ramp) {
    // A support slab under the low end, then the wedge itself.
    const baseMin: Vec3 = [0, 0, lowZ - SLAB_THICKNESS]
    const baseMax: Vec3 = [0, 0, lowZ]
    for (const i of [0, 1] as const) {
      baseMin[i] = bounds.min[i]!
      baseMax[i] = bounds.max[i]!
    }
    out.push(box(baseMin, baseMax, MATERIALS.floor))

    const rise: Cardinal = axis === 0
      ? (risesTowardMax ? Direction.East : Direction.West)
      : (risesTowardMax ? Direction.North : Direction.South)

    const wedgeMin: Vec3 = [0, 0, lowZ]
    const wedgeMax: Vec3 = [0, 0, highZ]
    for (const i of [0, 1] as const) {
      wedgeMin[i] = bounds.min[i]!
      wedgeMax[i] = bounds.max[i]!
    }
    const wedge: WedgeSolid = {
      kind: 'wedge', min: wedgeMin, max: wedgeMax, rise, material: MATERIALS.floor,
    }
    out.push(wedge)
  } else {
    // Stairs: 8-unit risers, tread depth divided evenly across the run. The
    // last riser is capped to `highZ` so a rise that isn't a multiple of 8
    // lands exactly on the upper floor instead of overshooting past it.
    const RISER = 8
    const steps = Math.ceil((highZ - lowZ) / RISER)
    const tread = (axisMax - axisMin) / steps
    for (let i = 0; i < steps; i++) {
      const min: Vec3 = [0, 0, lowZ - SLAB_THICKNESS]
      const max: Vec3 = [0, 0, Math.min(lowZ + (i + 1) * RISER, highZ)]
      // Both edges are computed from the same fixed anchor (axisMin or
      // axisMax) rather than one from the other, so adjacent treads land on
      // the exact same floating-point value at their shared boundary instead
      // of drifting by a few ULPs and leaving a sliver overlap or gap.
      if (risesTowardMax) {
        min[axis] = axisMin + i * tread
        max[axis] = axisMin + (i + 1) * tread
      } else {
        min[axis] = axisMax - (i + 1) * tread
        max[axis] = axisMax - i * tread
      }
      min[other] = bounds.min[other]!
      max[other] = bounds.max[other]!
      out.push(box(min, max, MATERIALS.floor))
    }
  }

  // The ceiling climbs with the floor (see corridorCeilings in solve.ts), so
  // the two ends can sit at different heights. Which end is which follows the
  // same derivation as the floor's.
  const ceilAtMin = fromAtMinEnd ? passage.fromCeilingZ : passage.toCeilingZ
  const ceilAtMax = fromAtMinEnd ? passage.toCeilingZ : passage.fromCeilingZ
  const ceilLow = Math.min(ceilAtMin, ceilAtMax)
  const ceilHigh = Math.max(ceilAtMin, ceilAtMax)

  // A corridor whose computed ceiling doesn't clear the lower end has no
  // meaningful side walls or ceiling to build; the floor geometry above
  // still marks it.
  if (ceilHigh > lowZ) {
    // Side walls run the full length of the corridor, outside its width.
    // They used to be inset by a wall's thickness at each end, on the
    // assumption that the adjoining room's own wall covers that 16-unit zone.
    // It does not: a room's wall starts at that room's floor, so anything
    // with a rise leaves the zone open below the higher floor, and a doorway
    // as wide as the shared face leaves the room emitting no wall on that
    // side at all. Running the full length instead duplicates brush where the
    // corridor meets each room's wall, which is untidy geometry; the inset
    // was a hole, which is a broken map.
    //
    // They run to the *higher* of the two ceilings rather than following the
    // slope, so that a sloped run stays two boxes rather than becoming a box
    // and a wedge per side. The extra material sits above the ceiling, out of
    // the playable space, and squaring the walls off keeps the corridor's air
    // bounded by flat faces at every height it reaches.
    for (const side of [-1, 1] as const) {
      const min: Vec3 = [0, 0, lowZ]
      const max: Vec3 = [0, 0, ceilHigh]
      min[axis] = bounds.min[axis]!
      max[axis] = bounds.max[axis]!
      if (side === -1) {
        min[other] = bounds.min[other]! - WALL_THICKNESS
        max[other] = bounds.min[other]!
      } else {
        min[other] = bounds.max[other]!
        max[other] = bounds.max[other]! + WALL_THICKNESS
      }
      if (max[axis]! > min[axis]!) out.push(box(min, max, MATERIALS.wall))
    }

    // The roof: a wedge hung upside down, its sloping underside carrying the
    // clear height from one end to the other, and a flat slab over the top of
    // it. On a level corridor the wedge is nothing and only the slab is
    // emitted, exactly as before.
    if (ceilHigh > ceilLow) {
      const wedgeMin: Vec3 = [0, 0, ceilLow]
      const wedgeMax: Vec3 = [0, 0, ceilHigh]
      for (const i of [0, 1] as const) {
        wedgeMin[i] = bounds.min[i]!
        wedgeMax[i] = bounds.max[i]!
      }
      const ceilingRise: Cardinal = axis === 0
        ? (ceilAtMax > ceilAtMin ? Direction.East : Direction.West)
        : (ceilAtMax > ceilAtMin ? Direction.North : Direction.South)
      out.push({
        kind: 'wedge', min: wedgeMin, max: wedgeMax, rise: ceilingRise,
        inverted: true, material: MATERIALS.ceiling,
      })
    }

    const ceilMin: Vec3 = [0, 0, ceilHigh]
    const ceilMax: Vec3 = [0, 0, ceilHigh + SLAB_THICKNESS]
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
    // Deliberately unpadded. Padding to fill the 16x16 corner columns works for
    // an isolated room but reaches into a flush neighbour's wall footprint,
    // producing overlapping brushes. The columns are sealed along the shared
    // vertical edge — unreachable and invisible — so they are left as they are.
    const span: Interval = { lo: bounds.min[other]!, hi: bounds.max[other]! }
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

    // A lintel spans the gap above any opening that stops short of the
    // ceiling, and a sill the gap below any opening that starts below this
    // room's own floor. The wall pieces above only cover floorZ..ceilingZ, so
    // without the sill a doorway onto a lower floor — a Transition.Step up
    // into this room — opens straight into the unbounded space beneath the
    // room's floor slab, which no solid owns.
    for (const hole of holes) {
      const lo = Math.max(hole.lo, span.lo)
      const hi = Math.min(hole.hi, span.hi)
      if (hi <= lo) continue
      const caps: Array<[number, number]> = []
      if (hole.top < ceilingZ) caps.push([hole.top, ceilingZ])
      if (hole.bottom < floorZ) caps.push([hole.bottom, floorZ])

      for (const [zMin, zMax] of caps) {
        const min: Vec3 = [0, 0, zMin]
        const max: Vec3 = [0, 0, zMax]
        min[axis] = wallMinAxis; max[axis] = wallMaxAxis
        min[other] = lo; max[other] = hi
        out.push(box(min, max, MATERIALS.wall))
      }
    }
  }

  return out
}
