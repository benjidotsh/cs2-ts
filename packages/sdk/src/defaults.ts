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

/**
 * CS2 rejects a spawn point whose origin is coplanar with the floor it stands
 * on — the player hull check reads it as stuck in world geometry, the spawn is
 * discarded, and a team with no valid spawns reports itself full. Valve's own
 * maps place spawns 16 units up.
 */
export const SPAWN_FLOOR_CLEARANCE = 16

/** Source's world extent: geometry beyond +/- this on any axis is not representable. */
export const WORLD_LIMIT = 16384
