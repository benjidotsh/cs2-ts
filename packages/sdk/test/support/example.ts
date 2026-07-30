import { CS2Map } from '../../src/map'
import { Direction, Team } from '../../src/types'

/**
 * A small map with everything the pipeline has to handle at least once: two
 * placement edges, a ramp with rise, and a team's spawns. Shared by the build
 * unit tests and the compile integration test, so the solid count the latter
 * asserts against tracks the map the former checks.
 */
export function example(): CS2Map {
  const map = new CS2Map('de_example')
  const t = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
  const mid = t.room({ name: 'mid', size: [1536, 1024, 256] },
    { direction: Direction.North, width: 192, length: 512 })
  mid.room({ name: 'aSite', size: [1024, 1024, 256] },
    { direction: Direction.East, width: 256, length: 384, rise: 128 })
  t.spawns(Team.T, { count: 5, facing: Direction.North })
  return map
}
