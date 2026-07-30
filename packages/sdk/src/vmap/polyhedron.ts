import { AXIS, cardinalOn } from '../geometry'
import { Direction, type Cardinal, type Solid, type Vec3 } from '../types'

export interface Polyhedron {
  positions: Vec3[]
  /** Index loops, counter-clockwise viewed from outside. */
  faces: number[][]
}

export function boxPolyhedron(min: Vec3, max: Vec3): Polyhedron {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  return {
    positions: [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ],
    faces: [
      [0, 3, 2, 1], // -Z bottom
      [4, 5, 6, 7], // +Z top
      [0, 1, 5, 4], // -Y
      [1, 2, 6, 5], // +X
      [2, 3, 7, 6], // +Y
      [3, 0, 4, 7], // -X
    ],
  }
}

/** The cardinal facing the other way down the same axis. */
const opposite = (d: Cardinal): Cardinal =>
  cardinalOn(AXIS[d].axis, AXIS[d].sign === -1)

/**
 * The vertical mirror of `wedgePolyhedron`: a flat top spanning the full
 * footprint, with the underside sloping down away from the `rise` side — the
 * shape a corridor ceiling needs when the floor below it ramps.
 *
 * Both halves of the construction are needed for the result to be a valid
 * solid. Reflecting z about the box's mid-height puts the sloped face on the
 * same plane as the upright wedge's (so a ramp and the ceiling over it climb
 * in step), and a reflection reverses orientation — so every face loop is
 * reversed too, which is what keeps the winding outward.
 *
 * Mirroring the *opposite* rise, rather than the same one, is what makes the
 * sloped face climb toward `rise` in both senses: the upright wedge's slope
 * descends away from its own high edge, and the reflection flips that.
 */
export function invertedWedgePolyhedron(
  min: Vec3, max: Vec3, rise: Cardinal,
): Polyhedron {
  const upright = wedgePolyhedron(min, max, opposite(rise))
  const flip = min[2] + max[2]
  return {
    positions: upright.positions.map(([x, y, z]): Vec3 => [x, y, flip - z]),
    faces: upright.faces.map((loop) => [...loop].reverse()),
  }
}

/**
 * Triangular prism whose floor spans the full footprint and whose top edge sits
 * on the `rise` side. Built by collapsing a box's two far-side top corners onto
 * the near side, then re-winding the affected faces.
 */
export function wedgePolyhedron(min: Vec3, max: Vec3, rise: Cardinal): Polyhedron {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const bottom: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
  ]

  // Top edge endpoints and the two bottom corners they sit above, per direction.
  const spec: Record<Cardinal, { top: [Vec3, Vec3]; above: [number, number] }> = {
    [Direction.East]:  { top: [[x1, y0, z1], [x1, y1, z1]], above: [1, 2] },
    [Direction.West]:  { top: [[x0, y1, z1], [x0, y0, z1]], above: [3, 0] },
    [Direction.North]: { top: [[x1, y1, z1], [x0, y1, z1]], above: [2, 3] },
    [Direction.South]: { top: [[x0, y0, z1], [x1, y0, z1]], above: [0, 1] },
  }

  const { top, above } = spec[rise]
  const positions: Vec3[] = [...bottom, top[0], top[1]]
  const [a, b] = above          // bottom corners under the top edge, in order
  const c = (b + 1) % 4         // remaining corners, continuing round the base
  const d = (b + 2) % 4
  const t0 = 4, t1 = 5

  return {
    positions,
    faces: [
      [0, 3, 2, 1],       // -Z bottom, unchanged
      [a, b, t1, t0],     // vertical face on the rise side
      [d, a, t0],         // triangular side
      [b, c, t1],         // triangular side
      [c, d, t0, t1],     // the slope
    ],
  }
}

export function solidPolyhedron(solid: Solid): Polyhedron {
  if (solid.kind === 'box') return boxPolyhedron(solid.min, solid.max)
  return solid.inverted
    ? invertedWedgePolyhedron(solid.min, solid.max, solid.rise)
    : wedgePolyhedron(solid.min, solid.max, solid.rise)
}
