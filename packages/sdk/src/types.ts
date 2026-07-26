export type Vec2 = [u: number, v: number]
export type Vec3 = [x: number, y: number, z: number]
export type Vec4 = [x: number, y: number, z: number, w: number]

export enum Direction {
  North = 'north',
  NorthEast = 'north-east',
  East = 'east',
  SouthEast = 'south-east',
  South = 'south',
  SouthWest = 'south-west',
  West = 'west',
  NorthWest = 'north-west',
}

/** Only cardinals may drive placement or connections. Diagonals are facing-only. */
export type Cardinal =
  | Direction.North | Direction.East | Direction.South | Direction.West

export enum Surface {
  Floor = 'floor', Ceiling = 'ceiling',
  North = 'north', East = 'east', South = 'south', West = 'west',
}

export enum Align {
  Center = 'center', Top = 'top', Bottom = 'bottom', Left = 'left', Right = 'right',
  TopLeft = 'top-left', TopRight = 'top-right',
  BottomLeft = 'bottom-left', BottomRight = 'bottom-right',
}

export enum Transition { Step = 'step', Ramp = 'ramp', Stairs = 'stairs' }
export enum Team { T = 'T', CT = 'CT' }
export enum Bombsite { A = 'A', B = 'B' }

export interface Placement {
  surface?: Surface
  align?: Align
  at?: Vec3
  facing?: Direction | number
}

export interface Extent {
  size: Vec3
}

export interface Aabb {
  min: Vec3
  max: Vec3
}

export interface BoxSolid {
  kind: 'box'
  min: Vec3
  max: Vec3
  material: string
}

/**
 * Triangular prism. The sloped face runs from `min[2]` to `max[2]`, climbing
 * toward `rise`, and is the same plane either way up:
 *
 * - upright (the default) fills the space **below** it — a ramp, flat on the
 *   bottom, sloping on top;
 * - `inverted` fills the space **above** it — a ceiling, flat on top, sloping
 *   underneath.
 */
export interface WedgeSolid {
  kind: 'wedge'
  min: Vec3
  max: Vec3
  rise: Cardinal
  inverted?: boolean
  material: string
}

export type Solid = BoxSolid | WedgeSolid

const CARDINALS = new Set<Direction>([
  Direction.North, Direction.East, Direction.South, Direction.West,
])

export function isCardinal(d: Direction): d is Cardinal {
  return CARDINALS.has(d)
}

/** Yaw in degrees, counter-clockwise from +X, matching Source's qangle. */
export function directionYaw(d: Direction): number {
  switch (d) {
    case Direction.East: return 0
    case Direction.NorthEast: return 45
    case Direction.North: return 90
    case Direction.NorthWest: return 135
    case Direction.West: return 180
    case Direction.SouthWest: return 225
    case Direction.South: return 270
    case Direction.SouthEast: return 315
  }
}

/** True only for genuine volume intersection; shared faces are not overlaps. */
export function aabbsOverlap(a: Aabb, b: Aabb): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.max[i]! <= b.min[i]! || b.max[i]! <= a.min[i]!) return false
  }
  return true
}
