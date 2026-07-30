import { MATERIALS, SLAB_THICKNESS, STAIR_RISER, WALL_THICKNESS } from './defaults'
import { cardinalOn, overlap1d } from './geometry'
import { isCorridor, type Layout, type Passage, type PlacedRoom } from './solve'
import {
  Transition,
  type Aabb, type BoxSolid, type Solid, type Vec3, type WedgeSolid,
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

/**
 * One of a room's four vertical faces. Openings are registered against a face
 * by name and read back by name, so the two spellings have to agree: as a
 * union they disagree at compile time rather than by quietly filing a doorway
 * under a key nobody reads, leaving an unbroken wall and a sealed-off room.
 */
type Side = `${'min' | 'max'}${'X' | 'Y'}`

type OpeningKey = `${number}:${Side}`

const openingKey = (roomId: number, side: Side): OpeningKey => `${roomId}:${side}`

/**
 * The two slabs a room lays over its own footprint — its floor and its ceiling,
 * each spanning the whole footprint with no openings in it. Shared with the wall
 * emitter, which has to know where other rooms' slabs are, so the two views of
 * the same brush cannot drift apart.
 */
function roomSlabs(room: PlacedRoom): [Aabb, Aabb] {
  const ceilingZ = room.bounds.max[2]!
  const [floorMin, floorMax] =
    footprint(room.bounds, room.floorZ - SLAB_THICKNESS, room.floorZ)
  const [ceilMin, ceilMax] =
    footprint(room.bounds, ceilingZ, ceilingZ + SLAB_THICKNESS)
  return [{ min: floorMin, max: floorMax }, { min: ceilMin, max: ceilMax }]
}

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
  const openings = new Map<OpeningKey, Opening[]>()
  const byId = new Map(layout.rooms.map((r) => [r.id, r]))

  const addOpening = (roomId: number, side: Side, opening: Opening) => {
    const list = openings.get(openingKey(roomId, side))
    if (list) list.push(opening)
    else openings.set(openingKey(roomId, side), [opening])
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
    const [fromSide, toSide]: [Side, Side] = passage.fromAtMinEnd
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

    if (isCorridor(passage)) solids.push(...corridorSolids(passage))
  }

  // Each room's walls have to give way to every *other* room's slabs; see
  // roomSolids. Its own are already flush with its walls.
  const slabsByRoom = new Map(layout.rooms.map((r) => [r.id, roomSlabs(r)]))
  for (const room of layout.rooms) {
    const foreign = layout.rooms
      .filter((r) => r.id !== room.id)
      .flatMap((r) => slabsByRoom.get(r.id)!)
    solids.push(...roomSolids(room, openings, foreign))
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
      rise: cardinalOn(axis, risesTowardMax), material: MATERIALS.floor,
    }
    out.push(wedge)
  } else {
    // Stairs: 8-unit risers, tread depth divided evenly across the run. The
    // last riser is capped to `highZ` so a rise that isn't a multiple of 8
    // lands exactly on the upper floor instead of overshooting past it.
    const steps = Math.ceil((highZ - lowZ) / STAIR_RISER)
    const tread = (axisMax - axisMin) / steps
    for (let i = 0; i < steps; i++) {
      const min: Vec3 = [0, 0, lowZ - SLAB_THICKNESS]
      const max: Vec3 = [0, 0, Math.min(lowZ + (i + 1) * STAIR_RISER, highZ)]
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
    out.push(box(min, max, MATERIALS.wall))
  }

  // The roof: a wedge hung upside down, its sloping underside carrying the
  // clear height from one end to the other, and a flat slab over the top of
  // it. On a level corridor the wedge is nothing and only the slab is
  // emitted, exactly as before.
  if (ceilHigh > ceilLow) {
    const [wedgeMin, wedgeMax] = footprint(bounds, ceilLow, ceilHigh)
    out.push({
      kind: 'wedge', min: wedgeMin, max: wedgeMax,
      rise: cardinalOn(axis, ceilAtMax > ceilAtMin),
      inverted: true, material: MATERIALS.ceiling,
    })
  }

  out.push(box(
    ...footprint(bounds, ceilHigh, ceilHigh + SLAB_THICKNESS), MATERIALS.ceiling))

  return out
}

function roomSolids(
  room: PlacedRoom, openings: Map<OpeningKey, Opening[]>, foreignSlabs: Aabb[],
): Solid[] {
  const { bounds, floorZ } = room
  const ceilingZ = bounds.max[2]!
  const out: Solid[] = []

  const [floor, ceiling] = roomSlabs(room)
  out.push(box(floor.min, floor.max, MATERIALS.floor))
  out.push(box(ceiling.min, ceiling.max, MATERIALS.ceiling))

  const sides: Array<{ side: Side; axis: 0 | 1; at: number; outward: -1 | 1 }> = [
    { side: 'minX', axis: 0, at: bounds.min[0]!, outward: -1 },
    { side: 'maxX', axis: 0, at: bounds.max[0]!, outward: 1 },
    { side: 'minY', axis: 1, at: bounds.min[1]!, outward: -1 },
    { side: 'maxY', axis: 1, at: bounds.max[1]!, outward: 1 },
  ]

  for (const { side, axis, at, outward } of sides) {
    const other: 0 | 1 = axis === 0 ? 1 : 0
    // Deliberately unpadded. Padding to fill the 16x16 corner columns works for
    // an isolated room but reaches into a flush neighbour's wall footprint,
    // producing overlapping brushes. The columns are sealed along the shared
    // vertical edge — unreachable and invisible — so they are left as they are.
    const span: Interval = { lo: bounds.min[other]!, hi: bounds.max[other]! }
    const holes = openings.get(openingKey(room.id, side)) ?? []

    const wallMinAxis = outward === -1 ? at - WALL_THICKNESS : at
    const wallMaxAxis = outward === -1 ? at : at + WALL_THICKNESS

    // A room's wall band sits *outside* its own bounds, which on a flush face
    // puts it inside the neighbour's — where that neighbour's floor and ceiling
    // slabs each span the whole footprint. Two rooms at different heights
    // therefore lay a slab straight across the band, and the brushes
    // interpenetrate. Equal heights never show it: the band runs exactly
    // floorZ..ceilingZ, which is precisely where both slabs stop.
    //
    // The slab wins. It has no openings in it, so ceding its z-range leaves the
    // space filled just the same. Cutting the slab instead would punch a hole
    // wherever the band has a doorway — a Step up into a room opens exactly
    // there, and its floor slab is the step's face.
    const cutting = foreignSlabs.filter((s) =>
      // Only a slab spanning the band's full thickness can stand in for it.
      s.min[axis]! <= wallMinAxis && s.max[axis]! >= wallMaxAxis)

    /** One piece of the band, less whatever another room's slab already fills. */
    const emitBand = (lo: number, hi: number, zLo: number, zHi: number) => {
      const across = cutting.filter((s) =>
        overlap1d(s.min[other]!, s.max[other]!, lo, hi).size > 0 &&
        overlap1d(s.min[2]!, s.max[2]!, zLo, zHi).size > 0)

      // Split at every slab edge, so within one run a slab either covers the
      // whole width or none of it and can be subtracted in z alone.
      const cuts = [...new Set([lo, hi, ...across
        .flatMap((s) => [s.min[other]!, s.max[other]!])
        .filter((v) => v > lo && v < hi)])].sort((x, y) => x - y)

      for (let i = 0; i + 1 < cuts.length; i++) {
        const runLo = cuts[i]!, runHi = cuts[i + 1]!
        const filled = across
          .filter((s) => s.min[other]! <= runLo && s.max[other]! >= runHi)
          .map((s) => ({ lo: s.min[2]!, hi: s.max[2]! }))

        for (const z of subtractIntervals({ lo: zLo, hi: zHi }, filled)) {
          const min: Vec3 = [0, 0, z.lo]
          const max: Vec3 = [0, 0, z.hi]
          min[axis] = wallMinAxis; max[axis] = wallMaxAxis
          min[other] = runLo; max[other] = runHi
          out.push(box(min, max, MATERIALS.wall))
        }
      }
    }

    for (const piece of subtractIntervals(span, holes)) {
      emitBand(piece.lo, piece.hi, floorZ, ceilingZ)
    }

    // A lintel spans the gap above any opening that stops short of the
    // ceiling, and a sill the gap below any opening that starts below this
    // room's own floor. The wall pieces above only cover floorZ..ceilingZ, so
    // without the sill a doorway onto a lower floor — a Transition.Step up
    // into this room — opens straight into the unbounded space beneath the
    // room's floor slab, which no solid owns.
    //
    // Two ways through can share one face — a doorway and a low cross
    // connection between the same pair of rooms both cut this wall — so the
    // caps are taken over the merged set rather than one per opening. Capping
    // each separately would plant the lower opening's lintel inside the taller
    // one, bricking it up, and stack two brushes wherever they overlap.
    //
    // Every opening either covers a whole gap between consecutive opening
    // edges or misses it entirely, so within one gap the wall is clear up to
    // the *highest* opening over it and must reach down to the *lowest* floor
    // outside it.
    const clipped = holes
      .map((h) =>
        ({ ...overlap1d(h.lo, h.hi, span.lo, span.hi), top: h.top, bottom: h.bottom }))
      .filter((h) => h.size > 0)
    const edges = [...new Set(clipped.flatMap((h) => [h.lo, h.hi]))]
      .sort((x, y) => x - y)

    for (let i = 0; i + 1 < edges.length; i++) {
      const lo = edges[i]!, hi = edges[i + 1]!
      const covering = clipped.filter((h) => h.lo <= lo && h.hi >= hi)
      if (covering.length === 0) continue

      const caps: Array<[number, number]> = []
      const top = Math.max(...covering.map((h) => h.top))
      const bottom = Math.min(...covering.map((h) => h.bottom))
      if (top < ceilingZ) caps.push([top, ceilingZ])
      if (bottom < floorZ) caps.push([bottom, floorZ])

      for (const [zMin, zMax] of caps) emitBand(lo, hi, zMin, zMax)
    }
  }

  return out
}
