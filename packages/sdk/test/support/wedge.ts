import { Direction, type Solid, type WedgeSolid } from '../../src/types'

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

/**
 * The z-interval `s` occupies in the column at (x, y), or null when the column
 * misses its footprint. A box fills its whole height; a wedge is solid below
 * its slope, and above it when inverted — the one statement of that rule the
 * geometry oracles share.
 *
 * The footprint test is strict at both edges, so a column landing exactly on a
 * boundary plane belongs to neither side.
 */
export function solidSpanAt(
  s: Solid, x: number, y: number,
): [number, number] | null {
  if (x <= s.min[0]! || x >= s.max[0]!) return null
  if (y <= s.min[1]! || y >= s.max[1]!) return null
  if (s.kind === 'box') return [s.min[2]!, s.max[2]!]
  const slope = wedgeSurfaceAt(s, x, y)
  return s.inverted ? [slope, s.max[2]!] : [s.min[2]!, slope]
}
