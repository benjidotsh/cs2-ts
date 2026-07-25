export type Vec2 = readonly [u: number, v: number]
export type Vec3 = readonly [x: number, y: number, z: number]
export type Vec4 = readonly [x: number, y: number, z: number, w: number]

export enum Direction {
  North, NorthEast, East, SouthEast, South, SouthWest, West, NorthWest,
}

/** Only cardinals may drive placement or connections. Diagonals are facing-only. */
export type Cardinal =
  | Direction.North | Direction.East | Direction.South | Direction.West

export enum Surface { Floor, Ceiling, North, East, South, West }

export enum Align {
  Center, Top, Bottom, Left, Right, TopLeft, TopRight, BottomLeft, BottomRight,
}

export enum Transition { Step, Ramp, Stairs }
export enum Team { T, CT }
export enum Bombsite { A, B }

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

/** Triangular prism. Floor at `min[2]`, rising to `max[2]` toward `rise`. */
export interface WedgeSolid {
  kind: 'wedge'
  min: Vec3
  max: Vec3
  rise: Cardinal
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
