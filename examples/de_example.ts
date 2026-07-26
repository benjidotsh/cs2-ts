import { CS2Map, Direction, Transition, Align, Team, Bombsite } from '@cs2-ts/sdk'

const map = new CS2Map('de_example')

// anchor — the only room the map itself places
const tSpawn = map.room({ name: 'tSpawn', size: [1024, 768, 192] })

// placement edges — create and position in one call
const mid   = tSpawn.room({ name: 'mid',   size: [1536, 1024, 256] },
                          { direction: Direction.North, width: 192, length: 512 })
const aSite = mid.room({ name: 'aSite', size: [1024, 1024, 256] },
                       { direction: Direction.East, width: 256, length: 384,
                         rise: 128, via: Transition.Ramp })

// a second route from spawn to the site, closing a loop
const conn = tSpawn.room({ name: 'connector', size: [1024, 768, 192] },
                         { direction: Direction.East, width: 192, length: 256 })

// height difference is derived, not authored — the ramp follows from it
map.connect(conn, aSite, { width: 192 })

tSpawn.spawns(Team.T, {
  count: 10,
  align: Align.Bottom,
  at: [0, 192, 0],           // nudge the grid clear of the south wall
  facing: Direction.North,
})
aSite.bombsite(Bombsite.A, { size: [512, 512, 128] })
mid.entity('light_omni', { at: [0, 0, 128] })

export default map
