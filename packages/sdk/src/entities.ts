import {
  MATERIALS, PLAYER_HULL_HEIGHT, PLAYER_HULL_RADIUS, SPAWN_FLOOR_CLEARANCE,
} from './defaults'
import { AuthoringError } from './errors'
import type { MapGraph, RoomNode } from './map'
import type { Layout, PlacedRoom } from './solve'
import type { VmapEntity } from './vmap/document'
import {
  Align, Bombsite, Surface, Team, directionYaw,
  type Placement, type Vec3,
} from './types'

/** -1 = min edge, 0 = centre, +1 = max edge, in (horizontal, vertical) order. */
const ALIGN_OFFSETS: Record<Align, [number, number]> = {
  [Align.Center]: [0, 0],
  [Align.Top]: [0, 1],
  [Align.Bottom]: [0, -1],
  [Align.Left]: [-1, 0],
  [Align.Right]: [1, 0],
  [Align.TopLeft]: [-1, 1],
  [Align.TopRight]: [1, 1],
  [Align.BottomLeft]: [-1, -1],
  [Align.BottomRight]: [1, -1],
}

export function resolvePlacement(
  room: PlacedRoom,
  placement: Placement,
): { origin: Vec3; yaw: number } {
  const surface = placement.surface ?? Surface.Floor
  const [h, v] = ALIGN_OFFSETS[placement.align ?? Align.Center]
  const { min, max } = room.bounds
  const mid = (i: 0 | 1 | 2) => (min[i]! + max[i]!) / 2
  const pick = (i: 0 | 1 | 2, k: number) => (k < 0 ? min[i]! : k > 0 ? max[i]! : mid(i))

  let origin: Vec3
  switch (surface) {
    case Surface.Floor:
      // Top-down view: horizontal is X, vertical is Y.
      origin = [pick(0, h), pick(1, v), room.floorZ]
      break
    case Surface.Ceiling:
      origin = [pick(0, h), pick(1, v), max[2]!]
      break
    // Wall cases below: Left/Right run along the wall, Top/Bottom are
    // vertical (unaffected by facing, so `v` is never negated). Left/Right
    // are as seen by someone standing inside the room, facing the wall
    // (i.e. the wall is in front of them, not behind them).
    //
    // Facing north (+Y): right hand = east (+X), left hand = west (-X).
    // So on the North wall, Left (h=-1) maps to min[0] (west) directly —
    // no negation.
    case Surface.North:
      origin = [pick(0, h), max[1]!, pick(2, v)]
      break
    // Facing south (-Y): right hand = west (-X), left hand = east (+X).
    // So on the South wall, Left (h=-1) must map to max[0] (east) — negated.
    case Surface.South:
      origin = [pick(0, -h), min[1]!, pick(2, v)]
      break
    // Facing east (+X): right hand = south (-Y), left hand = north (+Y).
    // So on the East wall, Left (h=-1) must map to max[1] (north) — negated.
    case Surface.East:
      origin = [max[0]!, pick(1, -h), pick(2, v)]
      break
    // Facing west (-X): right hand = north (+Y), left hand = south (-Y).
    // So on the West wall, Left (h=-1) maps to min[1] (south) directly —
    // no negation.
    case Surface.West:
      origin = [min[0]!, pick(1, h), pick(2, v)]
      break
  }

  const at = placement.at ?? [0, 0, 0]
  origin = [origin[0] + at[0], origin[1] + at[1], origin[2] + at[2]]

  // Direction members are strings; a number is always a literal yaw in degrees.
  const facing = placement.facing
  const yaw = facing === undefined
    ? 0
    : typeof facing === 'number'
      ? facing
      : directionYaw(facing)

  return { origin, yaw }
}

const SPAWN_CLASS: Record<Team, string> = {
  [Team.T]: 'info_player_terrorist',
  [Team.CT]: 'info_player_counterterrorist',
}

/**
 * csgo.fgd: `bomb_site_designation(choices) : "Bomb Site" : 0 = [0:"A" 1:"B"]`.
 * The letter is only the editor's label for the choice; the keyvalue itself is
 * the index. (There is no `bomb_site` key on the class at all.)
 */
const SITE_DESIGNATION: Record<Bombsite, string> = {
  [Bombsite.A]: '0',
  [Bombsite.B]: '1',
}

/** csgo.fgd's TeamNum base class: 2 = Terrorist, 3 = Counter-Terrorist. */
const TEAM_NUM: Record<Team, number> = {
  [Team.T]: 2,
  [Team.CT]: 3,
}

/**
 * A brush entity: its volume is world-space geometry rather than keyvalues, and
 * Valve puts its origin at the centre of that volume.
 */
function brushEntity(
  classname: string,
  min: Vec3,
  max: Vec3,
  properties: Record<string, string | number | boolean>,
): VmapEntity {
  return {
    classname,
    origin: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    angles: [0, 0, 0],
    properties,
    solids: [{ kind: 'box', min, max, material: MATERIALS.trigger }],
  }
}

export function roomEntities(room: PlacedRoom, node: RoomNode): VmapEntity[] {
  const out: VmapEntity[] = []

  for (const req of node.entities) {
    const { origin, yaw } = resolvePlacement(room, req.placement)
    out.push({
      classname: req.classname,
      origin,
      angles: [0, yaw, 0],
      properties: req.properties,
    })
  }

  for (const req of node.spawns) {
    if (req.count <= 0) {
      throw new AuthoringError(
        'SPAWN_GRID_TOO_LARGE',
        `room "${room.name}" requested ${req.count} spawns; count must be positive`,
        { room: room.name, count: req.count, spacing: req.spacing },
      )
    }

    const cols = Math.ceil(Math.sqrt(req.count))
    const rows = Math.ceil(req.count / cols)
    const gridW = (cols - 1) * req.spacing
    const gridH = (rows - 1) * req.spacing

    // The grid is centred on the resolved anchor, which may itself sit at an
    // edge or corner of the room (e.g. Align.Bottom) — so the fit check must
    // compare the grid's actual world extents against the room's bounds, not
    // just the grid's size against the room's overall size.
    const { origin, yaw } = resolvePlacement(room, req.placement)
    const gridMinX = origin[0] - gridW / 2
    const gridMaxX = origin[0] + gridW / 2
    const gridMinY = origin[1] - gridH / 2
    const gridMaxY = origin[1] + gridH / 2
    // Spawns are lifted off the floor (see SPAWN_FLOOR_CLEARANCE in
    // defaults.ts); a room shorter than the clearance would push them into
    // or above its own ceiling, so that has to fail the same fit check.
    const spawnZ = origin[2] + SPAWN_FLOOR_CLEARANCE

    // What has to fit is the player, not the origin. The walls stand at the
    // room's bounds, so an origin exactly on that plane buries half a 32-wide
    // hull in the wall — the same "stuck in geometry" rejection the floor
    // clearance avoids, reached sideways. The grid is measured with a hull's
    // half-width around it, and the standing height above it.
    const r = PLAYER_HULL_RADIUS
    if (
      gridMinX - r < room.bounds.min[0]! || gridMaxX + r > room.bounds.max[0]! ||
      gridMinY - r < room.bounds.min[1]! || gridMaxY + r > room.bounds.max[1]! ||
      spawnZ + PLAYER_HULL_HEIGHT > room.bounds.max[2]!
    ) {
      throw new AuthoringError(
        'SPAWN_GRID_TOO_LARGE',
        `${req.count} spawns at ${req.spacing}u spacing in room "${room.name}" need ` +
        `x:[${gridMinX - r},${gridMaxX + r}] y:[${gridMinY - r},${gridMaxY + r}] ` +
        `z:[${spawnZ},${spawnZ + PLAYER_HULL_HEIGHT}] to stand in, which ` +
        `falls outside the room's bounds x:[${room.bounds.min[0]},${room.bounds.max[0]}] ` +
        `y:[${room.bounds.min[1]},${room.bounds.max[1]}] z:[${room.bounds.min[2]},${room.bounds.max[2]}]`,
        { room: room.name, count: req.count, spacing: req.spacing },
      )
    }

    for (let i = 0; i < req.count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      out.push({
        classname: SPAWN_CLASS[req.team],
        origin: [
          gridMinX + col * req.spacing,
          gridMinY + row * req.spacing,
          spawnZ,
        ],
        angles: [0, yaw, 0],
        properties: { priority: 0, enabled: true },
      })
    }
  }

  for (const req of node.bombsites) {
    const { origin } = resolvePlacement(room, req.placement)
    const size = req.size ?? [
      room.bounds.max[0]! - room.bounds.min[0]!,
      room.bounds.max[1]! - room.bounds.min[1]!,
      128,
    ]
    // The placement anchors the footprint's centre and the volume's base; the
    // volume rises from there. Unchanged from when this was a point entity
    // with mins/maxs — only where the bounds live has changed.
    const min: Vec3 = [origin[0] - size[0] / 2, origin[1] - size[1] / 2, origin[2]]
    const max: Vec3 = [origin[0] + size[0] / 2, origin[1] + size[1] / 2, origin[2] + size[2]]
    // The full keyvalue set Hammer writes for this class, matching
    // template_defuse.vmap: the Parentname base's keys, then the class's own.
    out.push(brushEntity('func_bomb_target', min, max, {
      parentname: '',
      parentAttachmentName: '',
      'local.origin': '',
      'local.angles': '',
      'local.scales': '',
      useLocalOffset: 0,
      heistbomb: 0,
      bomb_mount_target: '',
      bomb_site_designation: SITE_DESIGNATION[req.site],
    }))
  }

  // A buy zone is injected rather than authored: it is map-level ceremony in
  // the same class as the sun and the sky, and a spawn room without one is a
  // spawn room whose team can never arm itself. One zone per room, covering
  // the room's whole interior, for the team that spawns there.
  const teams = [...new Set(node.spawns.map((s) => s.team))]
  for (const team of teams) {
    out.push(brushEntity(
      'func_buyzone',
      [room.bounds.min[0]!, room.bounds.min[1]!, room.floorZ],
      [room.bounds.max[0]!, room.bounds.max[1]!, room.bounds.max[2]!],
      { TeamNum: TEAM_NUM[team] },
    ))
  }

  return out
}

export function layoutEntities(layout: Layout, graph: MapGraph): VmapEntity[] {
  const byId = new Map(graph.rooms.map((r) => [r.id, r]))
  const out: VmapEntity[] = []
  for (const room of layout.rooms) {
    out.push(...roomEntities(room, byId.get(room.id)!))
  }
  return out
}
