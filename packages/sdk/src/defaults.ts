export const MATERIALS = {
  floor: 'materials/dev/reflectivity_30.vmat',
  wall: 'materials/dev/reflectivity_30.vmat',
  ceiling: 'materials/dev/reflectivity_30.vmat',
  lightmapVolume: 'materials/tools/toolslightmapres.vmat',
  /** The brush material Valve's own templates give bomb targets and buy zones. */
  trigger: 'materials/tools/toolstrigger.vmat',
} as const

export const WALL_THICKNESS = 16
export const SLAB_THICKNESS = 16

/** How far a player can step or jump up in one go, in units. */
export const MAX_STEP_RISE = 64

/** Height of one stair riser. A flight is however many of these the rise needs. */
export const STAIR_RISER = 8

/**
 * How many treads a flight divides into. The lowering pass builds them and the
 * solver's clearance guard reasons about where they land, so the division has
 * to be one number: a guard fitted to a different one mis-predicts silently.
 */
export const stairSteps = (rise: number): number =>
  Math.ceil(Math.abs(rise) / STAIR_RISER)

/**
 * CS2 rejects a spawn point whose origin is coplanar with the floor it stands
 * on — the player hull check reads it as stuck in world geometry, the spawn is
 * discarded, and a team with no valid spawns reports itself full. Valve's own
 * maps place spawns 16 units up.
 */
export const SPAWN_FLOOR_CLEARANCE = 16

/**
 * CS2's standing player hull is 32 x 32 x 72, centred on the spawn's origin in
 * x and y and rising from it in z. It has to fit in the room for the same
 * reason the origin has to clear the floor: the engine's hull check reads an
 * intersection with world geometry as stuck, discards the spawn, and a team
 * with no valid spawns reports itself full.
 */
export const PLAYER_HULL_RADIUS = 16
export const PLAYER_HULL_HEIGHT = 72

/** Source's world extent: geometry beyond +/- this on any axis is not representable. */
export const WORLD_LIMIT = 16384
