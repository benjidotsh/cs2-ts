import { MATERIALS, SLAB_THICKNESS, WALL_THICKNESS } from './defaults'
import type { Layout, Passage, PlacedRoom } from './solve'
import {
  Direction, Transition, overlap1d,
  type Aabb, type BoxSolid, type Cardinal, type Solid, type Vec3, type WedgeSolid,
} from './types'

export interface Interval { lo: number; hi: number }

/** Removes `holes` from `span`, merging overlaps. Zero-length results dropped. */
export function subtractIntervals(span: Interval, holes: Interval[]): Interval[] {
  const clipped = holes
    .map((h) => overlap1d(h.lo, h.hi, span.lo, span.hi))
    .filter((h) => h.size > 0)
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

/** Min/max pair over the whole of `bounds`'s footprint, from `zLo` up to `zHi`. */
const footprint = (bounds: Aabb, zLo: number, zHi: number): [Vec3, Vec3] => [
  [bounds.min[0]!, bounds.min[1]!, zLo],
  [bounds.max[0]!, bounds.max[1]!, zHi],
]

/** The cardinal a slope on `axis` climbs toward. */
const rising = (axis: 0 | 1, towardMax: boolean): Cardinal =>
  axis === 0
    ? (towardMax ? Direction.East : Direction.West)
    : (towardMax ? Direction.North : Direction.South)

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
  const byId = new Map(layout.rooms.map((r) => [r.id, r]))
  const key = (roomId: number, side: string) => `${roomId}:${side}`

  const addOpening = (roomId: number, side: string, opening: Opening) => {
    const list = openings.get(key(roomId, side))
    if (list) list.push(opening)
    else openings.set(key(roomId, side), [opening])
  }

  // Register the holes each passage punches, then emit corridor geometry.
  for (const passage of layout.passages) {
    const from = byId.get(passage.from)!
    const to = byId.get(passage.to)!
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

    // A passage abuts one face of each room it joins: whichever room sits at
    // the passage's min end is opened on its own max face, and vice versa.
    const label = passage.axis === 0 ? 'X' : 'Y'
    const [fromSide, toSide]: [string, string] = passage.fromAtMinEnd
      ? [`max${label}`, `min${label}`]
      : [`min${label}`, `max${label}`]

    // Each opening is cut to the corridor's own cross-section where it meets
    // that room, which on anything that climbs is higher at the top end than
    // at the bottom. The two are equal on a level corridor and on a flush
    // doorway, which has no roof of its own.
    addOpening(from.id, fromSide,
      { lo, hi, top: passage.fromCeilingZ, bottom: bottomOf(from) })
    addOpening(to.id, toSide,
      { lo, hi, top: passage.toCeilingZ, bottom: bottomOf(to) })

    if (passage.bounds.max[passage.axis]! > passage.bounds.min[passage.axis]!) {
      solids.push(...corridorSolids(passage))
    }
  }

  for (const room of layout.rooms) {
    solids.push(...roomSolids(room, openings))
  }

  return solids
}

function corridorSolids(passage: Passage): Solid[] {
  const { bounds, axis, fromAtMinEnd } = passage
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
    out.push(box(...footprint(bounds, lowZ - SLAB_THICKNESS, lowZ), MATERIALS.floor))
  } else if (passage.via === Transition.Ramp) {
    // A support slab under the low end, then the wedge itself.
    out.push(box(...footprint(bounds, lowZ - SLAB_THICKNESS, lowZ), MATERIALS.floor))

    const [wedgeMin, wedgeMax] = footprint(bounds, lowZ, highZ)
    const wedge: WedgeSolid = {
      kind: 'wedge', min: wedgeMin, max: wedgeMax,
      rise: rising(axis, risesTowardMax), material: MATERIALS.floor,
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
  // the two ends can sit at different heights.
  const ceilAtMin = fromAtMinEnd ? passage.fromCeilingZ : passage.toCeilingZ
  const ceilAtMax = fromAtMinEnd ? passage.toCeilingZ : passage.fromCeilingZ
  const ceilLow = Math.min(ceilAtMin, ceilAtMax)
  const ceilHigh = Math.max(ceilAtMin, ceilAtMax)

  // A corridor whose computed ceiling doesn't clear the lower end has no
  // meaningful side walls or ceiling to build; the floor geometry above
  // still marks it.
  if (ceilHigh <= lowZ) return out

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
    const [wedgeMin, wedgeMax] = footprint(bounds, ceilLow, ceilHigh)
    out.push({
      kind: 'wedge', min: wedgeMin, max: wedgeMax,
      rise: rising(axis, ceilAtMax > ceilAtMin),
      inverted: true, material: MATERIALS.ceiling,
    })
  }

  out.push(box(
    ...footprint(bounds, ceilHigh, ceilHigh + SLAB_THICKNESS), MATERIALS.ceiling))

  return out
}

function roomSolids(room: PlacedRoom, openings: Map<string, Opening[]>): Solid[] {
  const { bounds, floorZ } = room
  const ceilingZ = bounds.max[2]!
  const out: Solid[] = []

  out.push(box(...footprint(bounds, floorZ - SLAB_THICKNESS, floorZ), MATERIALS.floor))
  out.push(box(
    ...footprint(bounds, ceilingZ, ceilingZ + SLAB_THICKNESS), MATERIALS.ceiling))

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
      const { lo, hi, size } = overlap1d(hole.lo, hole.hi, span.lo, span.hi)
      if (size <= 0) continue
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
