import { MAX_STEP_RISE, WALL_THICKNESS, WORLD_LIMIT } from './defaults'
import { SolverError } from './errors'
import type { CrossEdge, MapGraph, PlacementEdge, RoomNode } from './map'
import {
  Direction, Transition, aabbsOverlap,
  type Aabb, type Cardinal, type Vec3,
} from './types'

export interface PlacedRoom {
  id: number
  name: string
  bounds: Aabb
  floorZ: number
}

export interface Passage {
  from: number
  to: number
  bounds: Aabb
  /** 0 when the passage runs along X, 1 when it runs along Y. */
  axis: 0 | 1
  width: number
  height: number | null
  fromZ: number
  toZ: number
  via: Transition
}

export interface Layout {
  name: string
  rooms: PlacedRoom[]
  passages: Passage[]
}

/** Travel axis (0=X, 1=Y) and sign for each cardinal. */
const AXIS: Record<Cardinal, { axis: 0 | 1; sign: 1 | -1 }> = {
  [Direction.East]: { axis: 0, sign: 1 },
  [Direction.West]: { axis: 0, sign: -1 },
  [Direction.North]: { axis: 1, sign: 1 },
  [Direction.South]: { axis: 1, sign: -1 },
}

const overlap1d = (aMin: number, aMax: number, bMin: number, bMax: number) => {
  const lo = Math.max(aMin, bMin)
  const hi = Math.min(aMax, bMax)
  return { lo, hi, size: hi - lo }
}

export function solve(graph: MapGraph): Layout {
  if (graph.rooms.length === 0) {
    return { name: graph.name, rooms: [], passages: [] }
  }

  const byId = new Map<number, RoomNode>(graph.rooms.map((r) => [r.id, r]))
  const placed = new Map<number, PlacedRoom>()
  const passages: Passage[] = []
  const name = (id: number) => byId.get(id)!.name

  // The anchor is the first declared room, centred on the origin at z = 0.
  const anchor = graph.rooms[0]!
  placed.set(anchor.id, {
    id: anchor.id,
    name: anchor.name,
    bounds: {
      min: [-anchor.size[0] / 2, -anchor.size[1] / 2, 0],
      max: [anchor.size[0] / 2, anchor.size[1] / 2, anchor.size[2]],
    },
    floorZ: 0,
  })

  // Placement edges form a tree in declaration order, so a single forward pass
  // always sees the parent before the child.
  for (const edge of graph.placements) {
    placeChild(edge)
  }

  for (const edge of graph.crossEdges) {
    routeCrossEdge(edge)
  }

  detectOverlaps()
  checkWorldBounds()

  return {
    name: graph.name,
    rooms: [...placed.values()],
    passages,
  }

  function placeChild(edge: PlacementEdge): void {
    const parent = placed.get(edge.parent)!
    const child = byId.get(edge.child)!
    const c = edge.connection
    const { axis, sign } = AXIS[c.direction]
    const other: 0 | 1 = axis === 0 ? 1 : 0

    if (c.width <= 0) {
      throw new SolverError(
        'INSUFFICIENT_FACE_OVERLAP',
        `connection from "${parent.name}" to "${child.name}" has non-positive ` +
        `width ${c.width}`,
        { parent: parent.name, child: child.name, width: c.width },
      )
    }

    if (c.length > 0 && c.length < 2 * WALL_THICKNESS) {
      throw new SolverError(
        'CORRIDOR_TOO_SHORT',
        `connection from "${parent.name}" to "${child.name}" has length ${c.length}, ` +
        `shorter than twice the wall thickness (${2 * WALL_THICKNESS}); a corridor ` +
        'that short cannot fit the walls of both rooms it joins',
        { parent: parent.name, child: child.name, length: c.length },
      )
    }

    if (c.rise !== 0 && c.length === 0 && c.via !== Transition.Step) {
      throw new SolverError(
        'SLOPE_WITHOUT_RUN',
        `connection from "${parent.name}" to "${child.name}" has rise ${c.rise} ` +
        'but length 0, leaving no room for a ramp or stairs to climb it; give it a ' +
        `length of at least ${Math.abs(c.rise)} units`,
        { parent: parent.name, child: child.name, rise: c.rise },
      )
    }

    if (c.rise !== 0 && c.via !== Transition.Step && Math.abs(c.rise) > c.length) {
      throw new SolverError(
        'RISE_CONFLICT',
        `connection from "${parent.name}" to "${child.name}" rises ${Math.abs(c.rise)} ` +
        `units over ${c.length} units of run, steeper than 1:1`,
        { parent: parent.name, child: child.name, rise: c.rise, run: c.length },
      )
    }

    // Transition.Step is a single ledge, however long the connection is: the
    // corridor floor stays at the lower room's level and the step happens at
    // the higher room's face. Beyond what a player can step or jump that is a
    // wall, not a route — the same rule cross edges already apply.
    if (c.via === Transition.Step && Math.abs(c.rise) > MAX_STEP_RISE) {
      throw new SolverError(
        'RISE_CONFLICT',
        `connection from "${parent.name}" to "${child.name}" steps ${Math.abs(c.rise)} ` +
        `units in one go, more than the ${MAX_STEP_RISE} units a player can step or ` +
        'jump; use Transition.Ramp or Transition.Stairs with enough length to climb it',
        { parent: parent.name, child: child.name, rise: c.rise, via: c.via },
      )
    }

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
    placed.set(child.id, { id: child.id, name: child.name, bounds, floorZ })

    // The passage spans the overlap of the two facing walls, centred.
    const span = overlap1d(
      parent.bounds.min[other]!, parent.bounds.max[other]!,
      bounds.min[other]!, bounds.max[other]!,
    )
    if (span.size < c.width) {
      const overlap = Math.max(0, span.size)
      throw new SolverError(
        'INSUFFICIENT_FACE_OVERLAP',
        `connection from "${parent.name}" to "${child.name}" is ${c.width} wide ` +
        `but the shared face only overlaps by ${overlap}`,
        { parent: parent.name, child: child.name, width: c.width, overlap },
      )
    }

    // A corridor never rises above the lower of the two rooms' own ceilings,
    // even when an explicit height would otherwise push it higher.
    const roomsCeiling = Math.min(parent.bounds.max[2]!, floorZ + child.size[2]!)
    const passageCeiling = c.height != null
      ? Math.min(Math.max(parent.floorZ, floorZ) + c.height, roomsCeiling)
      : roomsCeiling

    assertClearance(passageCeiling, Math.max(parent.floorZ, floorZ),
      `connection from "${parent.name}" to "${child.name}"`,
      { parent: parent.name, child: child.name })

    if (c.length > 0) {
      const centre = (span.lo + span.hi) / 2
      const pMin: Vec3 = [0, 0, floorZ]
      const pMax: Vec3 = [0, 0, passageCeiling]
      pMin[axis] = Math.min(parentFace, nearFace)
      pMax[axis] = Math.max(parentFace, nearFace)
      pMin[other] = centre - c.width / 2
      pMax[other] = centre + c.width / 2
      pMin[2] = Math.min(parent.floorZ, floorZ)

      passages.push({
        from: parent.id, to: child.id,
        bounds: { min: pMin, max: pMax },
        axis, width: c.width, height: c.height,
        fromZ: parent.floorZ, toZ: floorZ, via: c.via,
      })
    } else {
      // Flush rooms: a zero-thickness passage marks where to cut the openings.
      const centre = (span.lo + span.hi) / 2
      const pMin: Vec3 = [0, 0, Math.min(parent.floorZ, floorZ)]
      const pMax: Vec3 = [0, 0, passageCeiling]
      pMin[axis] = parentFace; pMax[axis] = parentFace
      pMin[other] = centre - c.width / 2
      pMax[other] = centre + c.width / 2

      passages.push({
        from: parent.id, to: child.id,
        bounds: { min: pMin, max: pMax },
        axis, width: c.width, height: c.height,
        fromZ: parent.floorZ, toZ: floorZ, via: c.via,
      })
    }
  }

  function routeCrossEdge(edge: CrossEdge): void {
    const a = placed.get(edge.a)!
    const b = placed.get(edge.b)!

    if (edge.width <= 0) {
      throw new SolverError(
        'INSUFFICIENT_FACE_OVERLAP',
        `connection between "${a.name}" and "${b.name}" has non-positive width ` +
        `${edge.width}`,
        { a: a.name, b: b.name, width: edge.width },
      )
    }

    // Track the best separated-but-too-narrow axis, so a real "the overlap is
    // too small" case is reported as such rather than falling through to
    // "unroutable" (which would claim the rooms aren't axis-separated at all).
    let bestOverlap: { overlap: number } | null = null

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
        if (span.size > 0 && (bestOverlap === null || span.size > bestOverlap.overlap)) {
          bestOverlap = { overlap: span.size }
        }
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
            { a: a.name, b: b.name, deltaZ, run, via: edge.via },
          )
        }
      }

      const centre = (span.lo + span.hi) / 2
      const loZ = Math.min(a.floorZ, b.floorZ)
      const hiZ = Math.max(a.floorZ, b.floorZ)
      // A corridor never rises above the lower of the two rooms' own ceilings,
      // even when an explicit height would otherwise push it higher.
      const roomsCeiling = Math.min(a.bounds.max[2]!, b.bounds.max[2]!)
      const ceiling = edge.height != null
        ? Math.min(hiZ + edge.height, roomsCeiling)
        : roomsCeiling

      assertClearance(ceiling, hiZ, `connection between "${a.name}" and "${b.name}"`,
        { a: a.name, b: b.name })

      const pMin: Vec3 = [0, 0, loZ]
      const pMax: Vec3 = [0, 0, ceiling]
      pMin[axis] = gapLo; pMax[axis] = gapHi
      pMin[other] = centre - edge.width / 2
      pMax[other] = centre + edge.width / 2

      passages.push({
        from: a.id, to: b.id,
        bounds: { min: pMin, max: pMax },
        axis, width: edge.width, height: edge.height,
        fromZ: a.floorZ, toZ: b.floorZ, via: edge.via,
      })
      return
    }

    if (bestOverlap !== null) {
      const overlap = Math.max(0, bestOverlap.overlap)
      throw new SolverError(
        'INSUFFICIENT_FACE_OVERLAP',
        `connection between "${a.name}" and "${b.name}" is ${edge.width} wide but the ` +
        `shared face only overlaps by ${overlap}`,
        { a: a.name, b: b.name, width: edge.width, overlap },
      )
    }

    throw new SolverError(
      'UNROUTABLE_CONNECTION',
      `cannot route a straight axis-aligned corridor between "${a.name}" and ` +
      `"${b.name}"; they are neither flush nor separated along a single axis ` +
      `with at least ${edge.width} units of overlap on the other`,
      { a: a.name, b: b.name, width: edge.width },
    )
  }

  /**
   * A way through needs clear height above the higher of the two floors it
   * joins. A corridor never rises above the lower of the two rooms' own
   * ceilings, so a rise that takes one room's floor up to (or past) the
   * other's ceiling leaves a doorway with no opening in it: geometry that
   * seals cleanly and is simply unreachable, which is the worst way for this
   * to fail.
   */
  function assertClearance(
    ceiling: number,
    floorTop: number,
    what: string,
    detail: Record<string, unknown>,
  ): void {
    if (ceiling > floorTop) return
    throw new SolverError(
      'INSUFFICIENT_CLEARANCE',
      `${what} has no clear height: the way through tops out at ${ceiling}, at or ` +
      `below the higher of the two floors (${floorTop}). Reduce the rise, make the ` +
      'lower room taller, or raise the connection height.',
      { ...detail, ceiling, floor: floorTop },
    )
  }

  /**
   * Rooms are placed relative to their parent, so a long chain of connections
   * walks away from the origin without anything noticing. Source cannot
   * represent geometry past +/-16384 on any axis, and a map that runs past it
   * fails in the compiler (or worse, silently) rather than here.
   */
  function checkWorldBounds(): void {
    const AXES = ['x', 'y', 'z'] as const

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

    for (const room of placed.values()) {
      check(room.bounds, `room "${room.name}"`, { room: room.name })
    }
    for (const passage of passages) {
      const between = `"${name(passage.from)}" and "${name(passage.to)}"`
      check(passage.bounds, `the corridor between ${between}`,
        { rooms: [name(passage.from), name(passage.to)] })
    }
  }

  function detectOverlaps(): void {
    const rooms = [...placed.values()]
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i]!, b = rooms[j]!
        if (!aabbsOverlap(a.bounds, b.bounds)) continue
        const by = [0, 1, 2].map((k) =>
          Math.min(a.bounds.max[k]!, b.bounds.max[k]!) -
          Math.max(a.bounds.min[k]!, b.bounds.min[k]!))
        throw new SolverError(
          'OVERLAP',
          `rooms "${a.name}" and "${b.name}" overlap by ` +
          `${by[0]} x ${by[1]} x ${by[2]} units`,
          { rooms: [a.name, b.name], overlap: by },
        )
      }
    }

    // A corridor may not drive through a room it does not connect. Zero-length
    // passages are just doorway markers and are skipped.
    for (const passage of passages) {
      if (passage.bounds.min[passage.axis]! === passage.bounds.max[passage.axis]!) {
        continue
      }
      for (const room of rooms) {
        if (room.id === passage.from || room.id === passage.to) continue
        if (!aabbsOverlap(passage.bounds, room.bounds)) continue
        throw new SolverError(
          'OVERLAP',
          `the corridor between "${name(passage.from)}" and "${name(passage.to)}" ` +
          `passes through room "${room.name}"`,
          {
            rooms: [name(passage.from), name(passage.to)],
            through: room.name,
          },
        )
      }
    }
  }
}
