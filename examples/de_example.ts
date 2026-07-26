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

// the defending side needs somewhere of its own to start
const ctSpawn = aSite.room({ name: 'ctSpawn', size: [1024, 768, 192] },
                           { direction: Direction.North, width: 256, length: 512 })

tSpawn.spawns(Team.T, {
  count: 10,
  align: Align.Bottom,
  at: [0, 192, 0],           // nudge the grid clear of the south wall
  facing: Direction.North,
})
ctSpawn.spawns(Team.CT, {
  count: 10,
  align: Align.Top,
  at: [0, -192, 0],          // nudge the grid clear of the north wall
  facing: Direction.South,   // looking back toward the site
})
aSite.bombsite(Bombsite.A, { size: [512, 512, 128] })
// light_omni2, not light_omni: CS2 has no such class, only the editor icon
// the omni2 uses. colormode 0 matters — csgo.fgd overrides the default to
// colour temperature, which would leave `color` inert.
mid.entity('light_omni2', { at: [0, 0, 128] }, {
  enabled: true,
  colormode: 0,
  color: '255 255 255',
  brightness_units: 1,       // lumens
  brightness_lumens: 2000,
  range: 512,
})

export default map
