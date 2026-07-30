import { layoutEntities } from './entities'
import { MATERIALS } from './defaults'
import type { CS2Map } from './map'
import { solve, type Layout } from './solve'
import { toSolids } from './solids'
import type { Solid, Vec3 } from './types'
import { serializeVmap, type VmapEntity } from './vmap/document'

/**
 * A generous box around everything, tagged for the lightmap resolution pass.
 * Unions the actual emitted solids (walls, corridors, ramps, stairs — not
 * just room bounds), so enclosing the compiled geometry is structural rather
 * than a coincidence of wall thickness staying inside the padding.
 */
function lightmapVolumeSolid(solids: Solid[]): Solid {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const solid of solids) {
    for (const i of [0, 1, 2] as const) {
      min[i] = Math.min(min[i], solid.min[i]!)
      max[i] = Math.max(max[i], solid.max[i]!)
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
  // Seeded with -Infinity so an entirely below-zero map still puts the sun
  // above its own ceiling; 0 is only the right fallback when there are no
  // rooms at all.
  const top = layout.rooms.length === 0
    ? 0
    : layout.rooms.reduce((z, r) => Math.max(z, r.bounds.max[2]!), -Infinity)
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
      // sky_day01_01 is a CS:GO skyname absent from CS2's own VPKs; using it
      // here compiles fine but the sky asset fails to load at runtime.
      // sky_csgo_cloudy01 is one CS2 actually ships. (worldspawn's own
      // "skyname" keyvalue elsewhere is a separate, inert Source 1 legacy
      // key that CS2 ignores — left alone.)
      //
      // No `enabled` key: env_sky has none. Its base classes are Targetname,
      // Parentname and EnableDisable, and EnableDisable's toggle is
      // `StartDisabled` (core/base.fgd:236), whose default is already 0.
      properties: { skyname: 'materials/skybox/sky_csgo_cloudy01.vmat' },
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
  // Computed before the push, not inside it: the volume is a box around
  // everything it is given, so feeding it a list it is already part of would
  // grow it by another pad on every pass.
  const lightmapVolume = lightmapVolumeSolid(solids)
  solids.push(lightmapVolume)

  // An explicitly authored classname is a deliberate override — skip
  // injecting the boilerplate version so e.g. a hand-authored
  // light_environment doesn't end up doubled (two suns double the lighting
  // bake; two info_map_parameters is undefined behaviour).
  const authored = layoutEntities(layout, map.graph)
  const taken = new Set(authored.map((e) => e.classname))
  const injected = boilerplateEntities(layout).filter((e) => !taken.has(e.classname))

  return serializeVmap({
    name: layout.name,
    solids,
    entities: [...authored, ...injected],
  })
}
