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
  return solid.kind === 'box'
    ? boxPolyhedron(solid.min, solid.max)
    : wedgePolyhedron(solid.min, solid.max, solid.rise)
}
