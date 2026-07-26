import { layoutEntities } from './entities'
import { MATERIALS } from './defaults'
import type { CS2Map } from './map'
import { solve, type Layout } from './solve'
import { toSolids } from './solids'
import type { Solid, Vec3 } from './types'
import { serializeVmap, type VmapEntity } from './vmap/document'

/** A generous box around everything, tagged for the lightmap resolution pass. */
export function lightmapVolumeSolid(layout: Layout): Solid {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const room of layout.rooms) {
    for (const i of [0, 1, 2] as const) {
      min[i] = Math.min(min[i], room.bounds.min[i]!)
      max[i] = Math.max(max[i], room.bounds.max[i]!)
    }
  }
  if (!Number.isFinite(min[0])) {
    return { kind: 'box', min: [-64, -64, -64], max: [64, 64, 64], material: MATERIALS.lightmapVolume }
  }
  const pad = 64
  return {
    kind: 'box',
    min: [min[0] - pad, min[1] - pad, min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
    material: MATERIALS.lightmapVolume,
  }
}

/**
 * Entities every map needs. Without a sun, a sky and map parameters a compiled
 * map is either black or unplayable, so these are injected rather than authored.
 */
export function boilerplateEntities(layout: Layout): VmapEntity[] {
  const top = layout.rooms.reduce((z, r) => Math.max(z, r.bounds.max[2]!), 0)
  return [
    {
      classname: 'light_environment',
      origin: [0, 0, top + 512],
      angles: [-40, 210, 0],
      properties: {
        color: '255 255 255',
        brightness: 5,
        angulardiameter: 1,
        skycolor: '188 210 240',
        skyintensity: 1,
        enabled: true,
      },
    },
    {
      classname: 'env_sky',
      origin: [0, 0, top + 512],
      angles: [0, 0, 0],
      properties: { skyname: 'materials/skybox/sky_day01_01.vmat', enabled: true },
    },
    {
      classname: 'info_map_parameters',
      origin: [0, 0, 0],
      angles: [0, 0, 0],
      properties: { bombradius: 500, buying: 0 },
    },
  ]
}

export function buildVmap(map: CS2Map): string {
  const layout = solve(map.graph)
  const solids = toSolids(layout)
  solids.push(lightmapVolumeSolid(layout))

  return serializeVmap({
    name: layout.name,
    solids,
    entities: [...layoutEntities(layout, map.graph), ...boilerplateEntities(layout)],
  })
}
