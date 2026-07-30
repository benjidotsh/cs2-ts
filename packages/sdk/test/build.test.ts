import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { boilerplateEntities, buildVmap } from '../src/build'
import { solve } from '../src/solve'
import { Bombsite, Direction, Team } from '../src/types'
import { example } from './support/example'

test('a built map contains geometry, spawns and lighting boilerplate', () => {
  const text = buildVmap(example())
  expect(text).toContain('<!-- dmx encoding keyvalues2 4 format vmap 40 -->')
  expect(text).toContain('"classname" "string" "info_player_terrorist"')
  expect(text).toContain('"classname" "string" "light_environment"')
  expect(text).toContain('"classname" "string" "env_sky"')
  expect(text).toContain('"classname" "string" "info_map_parameters"')
  expect(text).toContain('materials/tools/toolslightmapres.vmat')
})

test('a defuse map ships the brush entities the game mode needs', () => {
  const map = new CS2Map('de_brushes')
  const t = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
  const site = t.room({ name: 'aSite', size: [1024, 1024, 256] },
    { direction: Direction.North, width: 256, length: 384 })
  t.spawns(Team.T, { count: 5 })
  site.bombsite(Bombsite.A)
  const text = buildVmap(map)

  expect(text).toContain('"classname" "string" "func_bomb_target"')
  expect(text).toContain('"classname" "string" "func_buyzone"')
  expect(text).toContain('"bomb_site_designation" "string" "0"')
  // The whole point: both are @SolidClass, so each is a CMapEntity with a
  // child CMapMesh. Two brush entities, so two trigger-material meshes.
  expect(text.split('materials/tools/toolstrigger.vmat')).toHaveLength(3)
  // Nothing anywhere may carry the invented bounds keys the point-entity
  // version used to fake a volume with.
  expect(text).not.toContain('"mins.')
  expect(text).not.toContain('"maxs.')
  expect(text).not.toContain('"bomb_site" "string"')
})

test('the injected boilerplate emits no keyvalue the FGD does not declare', () => {
  // env_sky's only toggle is StartDisabled, inherited from EnableDisable
  // (core/base.fgd:236). An `enabled` key on it is silently ignored — the same
  // class of mistake as the bomb site's invented `bomb_site`/`mins.*`.
  const sky = boilerplateEntities(solve(example().graph))
    .find((e) => e.classname === 'env_sky')!
  expect(Object.keys(sky.properties)).toEqual(['skyname'])
})

test('builds are byte-stable', () => {
  expect(buildVmap(example())).toBe(buildVmap(example()))
})

test('an authored buy zone overrides the injected one instead of doubling it', () => {
  // The buy zone is injected from roomEntities, which build.ts labels
  // "authored" — so the override rule structurally could not see a real
  // authored func_buyzone, and the room came out with two overlapping zones.
  const map = new CS2Map('de_bz')
  const t = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
  t.spawns(Team.T, { count: 5 })
  t.entity('func_buyzone', {}, { TeamNum: 2 })
  const text = buildVmap(map)

  expect(text.split('"classname" "string" "func_buyzone"')).toHaveLength(2)
  // And the injected one still arrives when the author writes none.
  const plain = new CS2Map('de_bz2')
  const t2 = plain.room({ name: 'tSpawn', size: [1024, 768, 192] })
  t2.spawns(Team.T, { count: 5 })
  expect(buildVmap(plain).split('"classname" "string" "func_buyzone"')).toHaveLength(2)
})

test('an authored boilerplate classname overrides injection instead of duplicating', () => {
  const map = new CS2Map('de_dedup')
  const t = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
  // A deliberately authored light_environment must win outright, not merely
  // be joined by an injected second one — two suns double the lighting bake.
  t.entity('light_environment', {}, { color: '0 0 0', brightness: 1 })
  const text = buildVmap(map)

  // toContain can't see a duplicate, so count occurrences directly.
  const occurrences = text.split('"classname" "string" "light_environment"').length - 1
  expect(occurrences).toBe(1)
  expect(text).toContain('"classname" "string" "env_sky"')
  expect(text).toContain('"classname" "string" "info_map_parameters"')
})
