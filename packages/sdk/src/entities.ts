import { AuthoringError } from './errors'
import type { MapGraph, RoomNode } from './map'
import type { Layout, PlacedRoom } from './solve'
import type { VmapEntity } from './vmap/document'
import {
  Align, Bombsite, Surface, Team, directionYaw,
  type Direction, type Placement, type Vec3,
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

  // Direction members are the integers 0-7; anything else (including negative
  // numbers, fractions, or values above 7) is a literal yaw in degrees.
  const facing = placement.facing
  const yaw = facing === undefined
    ? 0
    : Number.isInteger(facing) && facing >= 0 && facing <= 7
      ? directionYaw(facing as Direction)
      : facing

  return { origin, yaw }
}

const SPAWN_CLASS: Record<Team, string> = {
  [Team.T]: 'info_player_terrorist',
  [Team.CT]: 'info_player_counterterrorist',
}

const SITE_NAME: Record<Bombsite, string> = {
  [Bombsite.A]: 'A',
  [Bombsite.B]: 'B',
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

    if (
      gridMinX < room.bounds.min[0]! || gridMaxX > room.bounds.max[0]! ||
      gridMinY < room.bounds.min[1]! || gridMaxY > room.bounds.max[1]!
    ) {
      throw new AuthoringError(
        'SPAWN_GRID_TOO_LARGE',
        `${req.count} spawns at ${req.spacing}u spacing in room "${room.name}" ` +
        `span x:[${gridMinX},${gridMaxX}] y:[${gridMinY},${gridMaxY}], which ` +
        `falls outside the room's bounds x:[${room.bounds.min[0]},${room.bounds.max[0]}] ` +
        `y:[${room.bounds.min[1]},${room.bounds.max[1]}]`,
        { room: room.name, count: req.count, spacing: req.spacing },
      )
    }

    for (let i = 0; i < req.count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      out.push({
        classname: SPAWN_CLASS[req.team],
        origin: [
          origin[0] - gridW / 2 + col * req.spacing,
          origin[1] - gridH / 2 + row * req.spacing,
          origin[2],
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
    out.push({
      classname: 'func_bomb_target',
      origin,
      angles: [0, 0, 0],
      properties: {
        bomb_site: SITE_NAME[req.site],
        heistbomb: 0,
        'mins.x': -size[0] / 2, 'mins.y': -size[1] / 2, 'mins.z': 0,
        'maxs.x': size[0] / 2, 'maxs.y': size[1] / 2, 'maxs.z': size[2],
      },
    })
  }

  return out
}

export function layoutEntities(layout: Layout, graph: MapGraph): VmapEntity[] {
  const out: VmapEntity[] = []
  for (const room of layout.rooms) {
    const node = graph.rooms.find((r) => r.id === room.id)!
    out.push(...roomEntities(room, node))
  }
  return out
}
