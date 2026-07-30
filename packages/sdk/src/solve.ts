import {
  MAX_STEP_RISE, SLAB_THICKNESS, STAIR_RISER, WALL_THICKNESS, WORLD_LIMIT,
  stairSteps,
} from './defaults'
import { SolverError } from './errors'
import type { CrossEdge, MapGraph, PlacementEdge, RoomNode } from './map'
import { AXIS, aabbsOverlap, overlap1d } from './geometry'
import { Transition, type Aabb, type Vec3 } from './types'

export interface PlacedRoom {
  id: number
  name: string
  bounds: Aabb
  /**
   * Always `bounds.min[2]`. Kept as a field because the lowering pipeline
   * reads it some thirty times — where a room's floor sits is the question,
   * and `bounds.min[2]!` is not the way to ask it. `placedRoom` below is the
   * only thing that sets it, so the two cannot drift apart.
   */
  floorZ: number
}

export interface Passage {
  from: number
  to: number
  bounds: Aabb
  /** 0 when the passage runs along X, 1 when it runs along Y. */
  axis: 0 | 1
  /**
   * Which end of the passage `from` sits at: true for the low end of `axis`,
   * false for the high end. This is the connection's own direction, recorded
   * because only the solver sees it — it is *not* a fact about `bounds`, which
   * cannot answer it at all for a flush doorway (where min and max coincide),
   * and a flush doorway is exactly the case where `toSolids` needs it to decide
   * which room's wall to open. Re-deriving it from the bounds would face both
   * rooms' doorways the wrong way and leave the shared wall solid: a map that
   * seals cleanly and cannot be walked through.
   */
  fromAtMinEnd: boolean
  fromZ: number
  toZ: number
  /**
   * Ceiling height at each end's own face. A corridor's roof follows its
   * floor, so that a rise does not eat the headroom: the two are equal on
   * anything level, and differ by the rise on anything that climbs. Each is
   * clamped to the ceiling of the room it meets, so neither end pokes out of
   * the room it opens into.
   */
  fromCeilingZ: number
  toCeilingZ: number
  via: Transition
}

export interface Layout {
  name: string
  rooms: PlacedRoom[]
  passages: Passage[]
}

/**
 * True for a passage with a corridor of its own to build, false for the
 * zero-thickness marker a flush doorway leaves behind — which only says where
 * to cut the two rooms' walls. The difference is thickness along the travel
 * axis, and nothing else.
 */
export const isCorridor = (p: Passage): boolean =>
  p.bounds.max[p.axis]! > p.bounds.min[p.axis]!

/** The one place floorZ is set, so it cannot drift from the bounds it mirrors. */
const placedRoom = (id: number, name: string, bounds: Aabb): PlacedRoom =>
  ({ id, name, bounds, floorZ: bounds.min[2]! })

/**
 * Ceiling height at each end of a corridor, given each end's floor and the
 * ceiling of the room it opens into.
 *
 * The clear height is the same at both ends, so a corridor that climbs takes
 * its roof up with it and a rise costs no headroom. Left flat over a ramp,
 * the far end of `connector -> aSite` in the shipped example came out 64
 * units tall — a standing player is 72 — and the corridor pinched shut.
 *
 * Unless the author asked for a specific height, the clear height is the
 * smaller of the two rooms' own interior heights: the most a corridor can
 * offer while still fitting through the shorter of the rooms it joins. Each
 * end is then clamped to that end's own room ceiling, so neither end opens
 * above the room it meets.
 */
function corridorCeilings(
  from: PassageEnd, to: PassageEnd, height: number | null,
): [CorridorEnd, CorridorEnd] {
  const clear = height ?? Math.min(
    from.roomCeilingZ - from.z, to.roomCeilingZ - to.z)
  return [
    { ...from, ceilingZ: Math.min(from.roomCeilingZ, from.z + clear) },
    { ...to, ceilingZ: Math.min(to.roomCeilingZ, to.z + clear) },
  ]
}

/**
 * Top of a flush doorway, shared by both of its sides. A doorway in a shared
 * wall has no roof of its own to bridge two heights with, so both sides get
 * the lower of the two ceilings. Cut the taller room's side any higher and it
 * looks out over the shorter room's ceiling slab into the void.
 *
 * Which also means it can run out of height altogether: a rise that takes one
 * room's floor up to (or past) the other's ceiling leaves a doorway with no
 * opening in it — geometry that seals cleanly and is simply unreachable, the
 * worst way for this to fail. Only a flush doorway can hit this; a corridor
 * carries its own roof up with its floor.
 */
function doorwayCeiling(
  aRoomCeilingZ: number, bRoomCeilingZ: number, floorTop: number,
  height: number | null, what: string, detail: Record<string, unknown>,
): number {
  const roomsCeiling = Math.min(aRoomCeilingZ, bRoomCeilingZ)
  const ceiling = height != null
    ? Math.min(floorTop + height, roomsCeiling)
    : roomsCeiling

  if (ceiling <= floorTop) {
    throw new SolverError(
      'INSUFFICIENT_CLEARANCE',
      `${what} has no clear height: the way through tops out at ${ceiling}, at or ` +
      `below the higher of the two floors (${floorTop}). Reduce the rise, make the ` +
      'lower room taller, or raise the connection height.',
      { ...detail, ceiling, floor: floorTop },
    )
  }
  return ceiling
}

/** One end of a way through: the floor it meets, and the room it opens into. */
interface PassageEnd {
  z: number
  roomCeilingZ: number
}

interface CorridorEnd extends PassageEnd {
  /** Top of the opening at this end. */
  ceilingZ: number
}

/**
 * A corridor that climbs needs more headroom than the climb itself, or the
 * way through pinches shut and the room beyond it is unreachable — geometry
 * that seals cleanly and cannot be walked, which is the worst way for this to
 * fail. It is the same fault doorwayCeiling rejects for a flush doorway; the
 * corridor path had no equivalent guard, so it shipped a map that compiled,
 * sealed, and could not be played.
 *
 * A room's WALL_THICKNESS wall band is where it happens: the lintel over the
 * opening is flat there while something under it is still rising.
 *
 * Every rule below was *measured*, not reasoned out. Four attempts to derive
 * them from the geometry were wrong, in both directions, so each is bracketed
 * against the emitted brushes using two flood fills: one with wedges inscribed
 * (air over-approximated), where "unreachable" is a proof, and one with them
 * circumscribed, where "reachable" is a proof. Over 272,384 corridor layouts —
 * both edge kinds, all transitions, rises of either sign including
 * non-multiples of a riser, runs from 32 up including non-multiples of a wall,
 * explicit heights either side of each threshold, and unequal room heights —
 * this accepts nothing that seals. Step and ramp are exact in both directions.
 */
function corridorPinches(
  from: CorridorEnd, to: CorridorEnd, run: number, via: Transition,
): CorridorEnd | null {
  // Derived, not passed: the rise a caller would hand in is `to.z - from.z`
  // either way, and the two disagreeing would have the guard measure a climb
  // the geometry does not make.
  const height = Math.abs(to.z - from.z)
  if (height === 0) return null

  // Only the lower end can pinch: its opening is the one capped below whatever
  // climbs over it. The higher end's opening rises along with the floor.
  const [low, far] = from.z <= to.z ? [from, to] : [to, from]
  const clear = low.ceilingZ - low.z
  const farClear = far.ceilingZ - far.z

  // A lintel is what the climb closes against, and there is only one when the
  // corridor's roof comes out below the room's own ceiling.
  const lintel = low.ceilingZ < low.roomCeilingZ

  // A ramp climbs evenly, so only its share of the rise crosses the band.
  if (via === Transition.Ramp) {
    return lintel && clear <= Math.min(height, height * WALL_THICKNESS / run)
      ? low : null
  }

  // A step keeps its floor low and lifts the whole rise at the far face, and
  // stairs do the same thing a tread at a time. Either way the air has to
  // carry over the rise between the two ends' openings.
  //
  // Clamped at zero because a cross edge can be shorter than a wall band, and
  // a negative term would read as though the far opening *removed* air —
  // refusing gaps that are hundreds of units clear.
  const carry = Math.max(0, run - WALL_THICKNESS) / WALL_THICKNESS
  if (clear + farClear * carry <= height) return low
  // At the shortest legal run the two bands abut, so the low room's lintel
  // meets the far room's sill with no corridor in between.
  if (run <= 2 * WALL_THICKNESS && lintel && clear <= height) return low

  // A tread lifts a whole riser while the roof has only sloped its share, so
  // however many treads start inside the band each cost one — plus a riser of
  // margin, which is what makes this side of it sound. Left tighter it accepts
  // corridors that seal; the cost is refusing some that hold under 32 units of
  // air, which is a third of a standing player and no route at all.
  if (via === Transition.Stairs) {
    const treads = Math.ceil(WALL_THICKNESS * stairSteps(height) / run)
    const band = Math.min(height, STAIR_RISER * (treads + 1))
    if (lintel && clear <= band) return low

    // Neither end may be within a couple of risers of shutting. Below that the
    // treads meet the roof somewhere out along the run — past the band this
    // looks at, and with no lintel at all when the room is shorter than the
    // connection — and the band-local view above cannot see it. Measured: the
    // two ways that happens need an end under 14 units of clear height, which
    // is a fifth of a standing player and no route in any case.
    if (Math.min(clear, farClear) <= 2 * STAIR_RISER) return low
  }

  return null
}

/**
 * The opening height at each end of a way through, and the verdict on whether
 * it can be walked.
 *
 * Both edge kinds resolve their ceilings the same way, and used to spell it
 * out separately, 80 lines apart under different names — which is how the
 * clearance guard came to be written into this code four times over. (Each
 * still builds its own bounds afterwards: they arrive at the two axis extents
 * differently enough that sharing that half would take more arguments than it
 * saves.)
 */
function passageCeilings(
  from: PassageEnd, to: PassageEnd,
  run: number, height: number | null, via: Transition,
  what: string, detail: Record<string, unknown>,
): [number, number] {
  // A flush pair shares one ceiling, having no corridor of its own to bridge
  // two heights with; anything with run carries its roof up with its floor.
  if (run <= 0) {
    const shared = doorwayCeiling(
      from.roomCeilingZ, to.roomCeilingZ, Math.max(from.z, to.z),
      height, what, detail)
    return [shared, shared]
  }

  const [fromEnd, toEnd] = corridorCeilings(from, to, height)

  // The guard hands back the end it blames, so the message cannot come to
  // quote a different one than the rule measured.
  const pinched = corridorPinches(fromEnd, toEnd, run, via)
  if (pinched) {
    const clear = pinched.ceilingZ - pinched.z
    throw new SolverError(
      'INSUFFICIENT_CLEARANCE',
      `${what} has only ${clear} units of clear height at its lower end to ` +
      `carry ${Math.abs(to.z - from.z)} units of climb, so the way through ` +
      'pinches shut where it meets that room and the far room cannot be ' +
      'reached. Raise the connection height, make the rooms taller, or give it ' +
      'more length to climb over.',
      { ...detail, clear, rise: to.z - from.z, run, via },
    )
  }
  return [fromEnd.ceilingZ, toEnd.ceilingZ]
}

function assertPositiveWidth(
  what: string, width: number, detail: Record<string, unknown>,
): void {
  if (width > 0) return
  throw new SolverError(
    'INSUFFICIENT_FACE_OVERLAP',
    `${what} has non-positive width ${width}`,
    { ...detail, width },
  )
}

const insufficientOverlap = (
  what: string, width: number, overlap: number, detail: Record<string, unknown>,
) => new SolverError(
  'INSUFFICIENT_FACE_OVERLAP',
  `${what} is ${width} wide but the shared face only overlaps by ${overlap}`,
  { ...detail, width, overlap },
)

/** Everything wrong with a placement connection that its own numbers can show. */
function assertConnectionSane(
  what: string, c: PlacementEdge['connection'], detail: Record<string, unknown>,
): void {
  assertPositiveWidth(what, c.width, detail)

  if (c.length > 0 && c.length < 2 * WALL_THICKNESS) {
    throw new SolverError(
      'CORRIDOR_TOO_SHORT',
      `${what} has length ${c.length}, shorter than twice the wall thickness ` +
      `(${2 * WALL_THICKNESS}); a corridor that short cannot fit the walls of both ` +
      'rooms it joins',
      { ...detail, length: c.length },
    )
  }

  if (c.rise !== 0 && c.length === 0 && c.via !== Transition.Step) {
    throw new SolverError(
      'SLOPE_WITHOUT_RUN',
      `${what} has rise ${c.rise} but length 0, leaving no room for a ramp or ` +
      'stairs to climb it; give it a length of at least ' +
      `${Math.abs(c.rise)} units`,
      { ...detail, rise: c.rise },
    )
  }

  if (c.rise !== 0 && c.via !== Transition.Step && Math.abs(c.rise) > c.length) {
    throw new SolverError(
      'RISE_CONFLICT',
      `${what} rises ${Math.abs(c.rise)} units over ${c.length} units of run, ` +
      'steeper than 1:1',
      { ...detail, rise: c.rise, run: c.length },
    )
  }

  // Transition.Step is a single ledge, however long the connection is: the
  // corridor floor stays at the lower room's level and the step happens at
  // the higher room's face. Beyond what a player can step or jump that is a
  // wall, not a route — the same rule cross edges already apply.
  if (c.via === Transition.Step && Math.abs(c.rise) > MAX_STEP_RISE) {
    throw new SolverError(
      'RISE_CONFLICT',
      `${what} steps ${Math.abs(c.rise)} units in one go, more than the ` +
      `${MAX_STEP_RISE} units a player can step or jump; use Transition.Ramp or ` +
      'Transition.Stairs with enough length to climb it',
      { ...detail, rise: c.rise, via: c.via },
    )
  }
}

export function solve(graph: MapGraph): Layout {
  if (graph.rooms.length === 0) {
    return { name: graph.name, rooms: [], passages: [] }
  }

  const byId = new Map<number, RoomNode>(graph.rooms.map((r) => [r.id, r]))
  const placed = new Map<number, PlacedRoom>()
  const passages: Passage[] = []

  // The anchor is the first declared room, centred on the origin at z = 0.
  const anchor = graph.rooms[0]!
  placed.set(anchor.id, placedRoom(anchor.id, anchor.name, {
    min: [-anchor.size[0] / 2, -anchor.size[1] / 2, 0],
    max: [anchor.size[0] / 2, anchor.size[1] / 2, anchor.size[2]],
  }))

  // Placement edges form a tree in declaration order, so a single forward pass
  // always sees the parent before the child.
  for (const edge of graph.placements) {
    placeChild(edge)
  }

  for (const edge of graph.crossEdges) {
    routeCrossEdge(edge)
  }

  const rooms = [...placed.values()]
  detectOverlaps(rooms, passages)
  checkWorldBounds(rooms, passages)

  return { name: graph.name, rooms, passages }

  function placeChild(edge: PlacementEdge): void {
    const parent = placed.get(edge.parent)!
    const child = byId.get(edge.child)!
    const c = edge.connection
    const { axis, sign } = AXIS[c.direction]
    const other: 0 | 1 = axis === 0 ? 1 : 0
    const what = `connection from "${parent.name}" to "${child.name}"`
    const detail = { parent: parent.name, child: child.name }

    assertConnectionSane(what, c, detail)

    const floorZ = parent.floorZ + c.rise

    // Position along the travel axis: parent's face, plus the corridor.
    const parentFace = sign === 1 ? parent.bounds.max[axis]! : parent.bounds.min[axis]!
    const nearFace = parentFace + sign * c.length
    const childMinAxis = sign === 1 ? nearFace : nearFace - child.size[axis]!
    const childMaxAxis = childMinAxis + child.size[axis]!

    // Position along the other axis: parent's centre, shifted by offset.
    const parentCentreOther =
      (parent.bounds.min[other]! + parent.bounds.max[other]!) / 2
    const childMinOther = parentCentreOther + c.offset - child.size[other]! / 2
    const childMaxOther = childMinOther + child.size[other]!

    const min: Vec3 = [0, 0, floorZ]
    const max: Vec3 = [0, 0, floorZ + child.size[2]!]
    min[axis] = childMinAxis; max[axis] = childMaxAxis
    min[other] = childMinOther; max[other] = childMaxOther

    const bounds: Aabb = { min, max }
    placed.set(child.id, placedRoom(child.id, child.name, bounds))

    // The passage spans the overlap of the two facing walls, centred.
    const span = overlap1d(
      parent.bounds.min[other]!, parent.bounds.max[other]!,
      bounds.min[other]!, bounds.max[other]!,
    )
    if (span.size < c.width) {
      throw insufficientOverlap(what, c.width, Math.max(0, span.size), detail)
    }

    const childCeilingZ = floorZ + child.size[2]!
    const centre = (span.lo + span.hi) / 2

    // `sign === 1` places the child up-axis of its parent, which puts "from"
    // (the parent) at the passage's min end.
    const fromAtMinEnd = sign === 1

    // A flush connection leaves `nearFace` on `parentFace`, so the bounds
    // built below come out as the zero-thickness marker that tells toSolids
    // where to cut — no separate branch for it.
    const [fromCeilingZ, toCeilingZ] = passageCeilings(
      { z: parent.floorZ, roomCeilingZ: parent.bounds.max[2]! },
      { z: floorZ, roomCeilingZ: childCeilingZ },
      c.length, c.height, c.via, what, detail)

    const pMin: Vec3 = [0, 0, Math.min(parent.floorZ, floorZ)]
    const pMax: Vec3 = [0, 0, Math.max(fromCeilingZ, toCeilingZ)]
    pMin[axis] = Math.min(parentFace, nearFace)
    pMax[axis] = Math.max(parentFace, nearFace)
    pMin[other] = centre - c.width / 2
    pMax[other] = centre + c.width / 2

    passages.push({
      from: parent.id, to: child.id,
      bounds: { min: pMin, max: pMax },
      axis, fromAtMinEnd,
      fromZ: parent.floorZ, toZ: floorZ,
      fromCeilingZ, toCeilingZ, via: c.via,
    })
  }

  function routeCrossEdge(edge: CrossEdge): void {
    const a = placed.get(edge.a)!
    const b = placed.get(edge.b)!
    const what = `connection between "${a.name}" and "${b.name}"`
    const detail = { a: a.name, b: b.name }

    assertPositiveWidth(what, edge.width, detail)

    // Track the best separated-but-too-narrow axis, so a real "the overlap is
    // too small" case is reported as such rather than falling through to
    // "unroutable" (which would claim the rooms aren't axis-separated at all).
    let bestOverlap = 0

    for (const axis of [0, 1] as const) {
      const other: 0 | 1 = axis === 0 ? 1 : 0
      const gapLo = Math.min(a.bounds.max[axis]!, b.bounds.max[axis]!)
      const gapHi = Math.max(a.bounds.min[axis]!, b.bounds.min[axis]!)
      const separated = gapHi >= gapLo
      if (!separated) continue

      const span = overlap1d(
        a.bounds.min[other]!, a.bounds.max[other]!,
        b.bounds.min[other]!, b.bounds.max[other]!,
      )
      if (span.size < edge.width) {
        // Only a genuine (positive) facing overlap that is merely too narrow
        // counts as "insufficient" — a non-positive span means the rooms don't
        // face each other on this axis at all, which is unroutable, not narrow.
        if (span.size > bestOverlap) bestOverlap = span.size
        continue
      }

      const deltaZ = Math.abs(b.floorZ - a.floorZ)
      if (deltaZ > 0) {
        const run = gapHi - gapLo
        const traversable = edge.via === Transition.Step
          ? deltaZ <= MAX_STEP_RISE         // beyond a step or a jump it is a wall
          : run > 0 && deltaZ <= run        // ramps and stairs need run, and no steeper than 1:1
        if (!traversable) {
          throw new SolverError(
            'RISE_CONFLICT',
            `"${a.name}" and "${b.name}" differ in floor height by ${deltaZ} units, which ` +
            `${edge.via === Transition.Step
              ? 'is more than a player can step or jump'
              : `cannot be traversed over ${run} units of run`}`,
            { ...detail, deltaZ, run, via: edge.via },
          )
        }
      }

      const centre = (span.lo + span.hi) / 2
      const loZ = Math.min(a.floorZ, b.floorZ)
      const hiZ = Math.max(a.floorZ, b.floorZ)

      const [aCeilingZ, bCeilingZ] = passageCeilings(
        { z: a.floorZ, roomCeilingZ: a.bounds.max[2]! },
        { z: b.floorZ, roomCeilingZ: b.bounds.max[2]! },
        gapHi - gapLo, edge.height, edge.via, what, detail)

      const pMin: Vec3 = [0, 0, loZ]
      const pMax: Vec3 = [0, 0, Math.max(aCeilingZ, bCeilingZ)]
      pMin[axis] = gapLo; pMax[axis] = gapHi
      pMin[other] = centre - edge.width / 2
      pMax[other] = centre + edge.width / 2

      passages.push({
        from: a.id, to: b.id,
        bounds: { min: pMin, max: pMax },
        axis,
        // The gap runs from `a`'s far face when `a` is the lower of the two.
        fromAtMinEnd: a.bounds.max[axis]! <= gapLo,
        fromZ: a.floorZ, toZ: b.floorZ,
        fromCeilingZ: aCeilingZ, toCeilingZ: bCeilingZ, via: edge.via,
      })
      return
    }

    if (bestOverlap > 0) {
      throw insufficientOverlap(what, edge.width, bestOverlap, detail)
    }

    throw new SolverError(
      'UNROUTABLE_CONNECTION',
      `cannot route a straight axis-aligned corridor between "${a.name}" and ` +
      `"${b.name}"; they are neither flush nor separated along a single axis ` +
      `with at least ${edge.width} units of overlap on the other`,
      { ...detail, width: edge.width },
    )
  }
}

/**
 * Rooms are placed relative to their parent, so a long chain of connections
 * walks away from the origin without anything noticing. Source cannot
 * represent geometry past +/-16384 on any axis, and a map that runs past it
 * fails in the compiler (or worse, silently) rather than here.
 */
function checkWorldBounds(rooms: PlacedRoom[], passages: Passage[]): void {
  const AXES = ['x', 'y', 'z'] as const
  const nameOf = new Map(rooms.map((r) => [r.id, r.name]))

  const check = (bounds: Aabb, what: string, detail: Record<string, unknown>) => {
    for (let k = 0; k < 3; k++) {
      for (const value of [bounds.min[k]!, bounds.max[k]!]) {
        if (Math.abs(value) <= WORLD_LIMIT) continue
        throw new SolverError(
          'OUT_OF_BOUNDS',
          `${what} reaches ${value} on the ${AXES[k]} axis, outside Source's ` +
          `+/-${WORLD_LIMIT} unit world; move it nearer the anchor room or shorten ` +
          'the chain of connections leading to it',
          { ...detail, axis: AXES[k], value, limit: WORLD_LIMIT },
        )
      }
    }
  }

  for (const room of rooms) {
    check(room.bounds, `room "${room.name}"`, { room: room.name })
  }
  for (const passage of passages) {
    const from = nameOf.get(passage.from)!, to = nameOf.get(passage.to)!
    check(passage.bounds, `the corridor between "${from}" and "${to}"`,
      { rooms: [from, to] })
  }
}

/**
 * A room's brushes reach past its own bounds: the floor and ceiling slabs sit
 * SLAB_THICKNESS below the floor and above the ceiling (see roomSlabs).
 *
 * The wall bands, which stand WALL_THICKNESS outside the footprint, are
 * deliberately *not* included: flush neighbours share that zone by design, and
 * roomSolids already resolves it by ceding the band to the slab.
 */
const roomBrushes = (room: PlacedRoom): Aabb => ({
  min: [room.bounds.min[0]!, room.bounds.min[1]!, room.bounds.min[2]! - SLAB_THICKNESS],
  max: [room.bounds.max[0]!, room.bounds.max[1]!, room.bounds.max[2]! + SLAB_THICKNESS],
})

/**
 * A corridor's brushes likewise reach past `bounds`: a side wall
 * WALL_THICKNESS out on either side of the cross axis, and floor and ceiling
 * slabs SLAB_THICKNESS below and above (see corridorSolids).
 *
 * Two boxes, not one grown both ways. The side walls only span the corridor's
 * own height, and the slabs only its own width, so a single box would also
 * claim the four corner shells where those two expansions meet — and no brush
 * is ever built there. Claiming them refuses legal, sealed layouts: a room
 * tucked diagonally past a corridor's end, touching nothing.
 */
function corridorBrushes(p: Passage): [Aabb, Aabb] {
  const other: 0 | 1 = p.axis === 0 ? 1 : 0
  const walls = {
    min: [...p.bounds.min] as Vec3,
    max: [...p.bounds.max] as Vec3,
  }
  walls.min[other] -= WALL_THICKNESS
  walls.max[other] += WALL_THICKNESS

  const slabs = {
    min: [...p.bounds.min] as Vec3,
    max: [...p.bounds.max] as Vec3,
  }
  slabs.min[2] -= SLAB_THICKNESS
  slabs.max[2] += SLAB_THICKNESS

  return [walls, slabs]
}

/**
 * Bounds describe the space a room or corridor claims; the brushes are what
 * actually gets built, and they stand outside it. A shared face is not an
 * overlap (see aabbsOverlap), so anything weighed bounds-against-bounds could
 * graze its neighbour and pass while the slab or wall it emits landed squarely
 * inside that neighbour's playable space. Nothing here is weighed that way.
 *
 * Room against room goes further and weighs brushes against brushes, because
 * two rooms can hold their interiors clear of each other while their slabs
 * interpenetrate. Corridors do not: a corridor's side walls share the wall
 * band with the rooms it joins by design, so those are weighed against
 * interiors only.
 */
function detectOverlaps(rooms: PlacedRoom[], passages: Passage[]): void {
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!, b = rooms[j]!
      // Two rooms stacked 16 to 31 units apart keep their interiors clear of
      // each other while their slabs coincide or interpenetrate — two visible
      // surfaces fighting over one plane. Only z is expanded, so flush
      // neighbours are untouched.
      if (!aabbsOverlap(roomBrushes(a), roomBrushes(b))) continue
      const by = [0, 1, 2].map((k) =>
        overlap1d(a.bounds.min[k]!, a.bounds.max[k]!, b.bounds.min[k]!, b.bounds.max[k]!).size)
      throw new SolverError(
        'OVERLAP',
        // The interiors may be clear and only the slabs in conflict, in which
        // case one of `by` reads 0 and quoting it alone would look like a
        // contradiction. Say which of the two it is.
        aabbsOverlap(a.bounds, b.bounds)
          ? `rooms "${a.name}" and "${b.name}" overlap by ` +
            `${by[0]} x ${by[1]} x ${by[2]} units`
          : `rooms "${a.name}" and "${b.name}" do not overlap, but their floor and ` +
            `ceiling slabs do: one sits within ${SLAB_THICKNESS} units of the other, ` +
            'and each room lays a slab that thick outside its own floor and ceiling',
        { rooms: [a.name, b.name], overlap: by },
      )
    }
  }

  // Zero-length passages are just doorway markers, with no volume of their own
  // to collide with anything.
  const corridors = passages.filter(isCorridor)
  const nameOf = new Map(rooms.map((r) => [r.id, r.name]))
  const between = (p: Passage) => [nameOf.get(p.from)!, nameOf.get(p.to)!]

  // A corridor may not drive through a room it does not connect.
  for (const passage of corridors) {
    const brushes = corridorBrushes(passage)
    for (const room of rooms) {
      if (room.id === passage.from || room.id === passage.to) continue
      if (!brushes.some((b) => aabbsOverlap(b, room.bounds)) &&
          !aabbsOverlap(passage.bounds, roomBrushes(room))) continue
      const [from, to] = between(passage)
      throw new SolverError(
        'OVERLAP',
        `the corridor between "${from}" and "${to}" ` +
        `passes through room "${room.name}"`,
        { rooms: [from, to], through: room.name },
      )
    }
  }

  // Nor through another corridor. Two that cross sever each other: each one's
  // side walls stand solid across the other's interior, so the map compiles
  // and neither route goes anywhere.
  //
  // Two corridors joining the *same* pair of rooms are exempt: they run in the
  // same gap and so overlap by construction, which is a second way through the
  // same wall — untidy, but not a severed route.
  const sameRooms = (p: Passage, q: Passage) =>
    (p.from === q.from && p.to === q.to) || (p.from === q.to && p.to === q.from)

  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      const p = corridors[i]!, q = corridors[j]!
      if (sameRooms(p, q)) continue
      if (!corridorBrushes(p).some((b) => aabbsOverlap(b, q.bounds)) &&
          !corridorBrushes(q).some((b) => aabbsOverlap(b, p.bounds))) continue
      const [pFrom, pTo] = between(p), [qFrom, qTo] = between(q)
      throw new SolverError(
        'OVERLAP',
        `the corridor between "${pFrom}" and "${pTo}" crosses the corridor ` +
        `between "${qFrom}" and "${qTo}"`,
        { rooms: [pFrom, pTo], crosses: [qFrom, qTo] },
      )
    }
  }
}
