export const MATERIALS = {
  floor: 'materials/dev/reflectivity_30.vmat',
  wall: 'materials/dev/reflectivity_30.vmat',
  ceiling: 'materials/dev/reflectivity_30.vmat',
  lightmapVolume: 'materials/tools/toolslightmapres.vmat',
} as const

export const WALL_THICKNESS = 16
export const SLAB_THICKNESS = 16

/** How far a player can step or jump up in one go, in units. */
export const MAX_STEP_RISE = 64

/** Source's world extent: geometry beyond +/- this on any axis is not representable. */
export const WORLD_LIMIT = 16384
