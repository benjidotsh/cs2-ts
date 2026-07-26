import { Direction, type WedgeSolid } from '../../src/types'

/**
 * Height of a wedge's sloped face at (x, y) — the same plane whichever way up
 * the wedge is, so an upright ramp is solid below it and an inverted ceiling
 * solid above it.
 *
 * This is the oracle the geometry tests check the emitted wedges against, so it
 * deliberately restates the plane from `rise` rather than sharing code with
 * `wedgePolyhedron`.
 */
export function wedgeSurfaceAt(s: WedgeSolid, x: number, y: number): number {
  const [x0, y0, z0] = s.min
  const [x1, y1, z1] = s.max
  switch (s.rise) {
    case Direction.East: return z0 + (z1 - z0) * (x - x0) / (x1 - x0)
    case Direction.West: return z0 + (z1 - z0) * (x1 - x) / (x1 - x0)
    case Direction.North: return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    case Direction.South: return z0 + (z1 - z0) * (y1 - y) / (y1 - y0)
  }
}
