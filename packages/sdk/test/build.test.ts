import { expect, test } from 'bun:test'
import { CS2Map } from '../src/map'
import { buildVmap } from '../src/build'
import { Direction, Team } from '../src/types'

function example() {
  const map = new CS2Map('de_example')
  const t = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
  const mid = t.room({ name: 'mid', size: [1536, 1024, 256] },
    { direction: Direction.North, width: 192, length: 512 })
  mid.room({ name: 'aSite', size: [1024, 1024, 256] },
    { direction: Direction.East, width: 256, length: 384, rise: 128 })
  t.spawns(Team.T, { count: 5, facing: Direction.North })
  return map
}

test('a built map contains geometry, spawns and lighting boilerplate', () => {
  const text = buildVmap(example())
  expect(text).toContain('<!-- dmx encoding keyvalues2 4 format vmap 40 -->')
  expect(text).toContain('"classname" "string" "info_player_terrorist"')
  expect(text).toContain('"classname" "string" "light_environment"')
  expect(text).toContain('"classname" "string" "env_sky"')
  expect(text).toContain('"classname" "string" "info_map_parameters"')
  expect(text).toContain('materials/tools/toolslightmapres.vmat')
})

test('builds are byte-stable', () => {
  expect(buildVmap(example())).toBe(buildVmap(example()))
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
