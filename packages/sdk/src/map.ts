import { AuthoringError } from './errors'
import {
  Bombsite, Team, Transition, isCardinal,
  type Cardinal, type Placement, type Vec3,
} from './types'

export interface RoomSpec {
  name: string
  size: Vec3
}

/** A connection's height is the clear height of the way through, if given. */
function assertPositiveHeight(
  what: string, height: number | undefined, detail: Record<string, unknown>,
): void {
  if (height == null || height > 0) return
  throw new AuthoringError(
    'NEGATIVE_HEIGHT',
    `${what} has height ${height}; a connection's height is the clear height of ` +
    'the way through and must be greater than 0',
    { ...detail, height },
  )
}

export interface Connection {
  direction: Cardinal
  width: number
  length: number
  height?: number
  offset?: number
  rise?: number
  via?: Transition
}

export interface CrossConnection {
  width: number
  height?: number
  via?: Transition
}

export interface EntityRequest {
  classname: string
  placement: Placement
  properties: Record<string, string | number | boolean>
}

export interface SpawnRequest {
  team: Team
  count: number
  spacing: number
  placement: Placement
}

export interface BombsiteRequest {
  site: Bombsite
  placement: Placement
  size: Vec3 | null
}

export interface RoomNode {
  id: number
  name: string
  size: Vec3
  entities: EntityRequest[]
  spawns: SpawnRequest[]
  bombsites: BombsiteRequest[]
}

export interface ResolvedConnection {
  direction: Cardinal
  width: number
  length: number
  /** null means "full wall height", resolved once room heights are known. */
  height: number | null
  offset: number
  rise: number
  via: Transition
}

export interface PlacementEdge {
  parent: number
  child: number
  connection: ResolvedConnection
}

export interface CrossEdge {
  a: number
  b: number
  width: number
  height: number | null
  via: Transition
}

export interface MapGraph {
  name: string
  rooms: RoomNode[]
  placements: PlacementEdge[]
  crossEdges: CrossEdge[]
}

export interface SpawnOptions extends Placement {
  count: number
  spacing?: number
}

export interface BombsiteOptions extends Placement {
  size?: Vec3
}

class Room {
  constructor(
    readonly id: number,
    readonly node: RoomNode,
    private readonly map: CS2Map,
  ) {}

  get name(): string { return this.node.name }

  /** Creates a room positioned relative to this one. */
  room(spec: RoomSpec, connection: Connection): Room {
    return this.map.addChild(this, spec, connection)
  }

  entity(
    classname: string,
    placement: Placement = {},
    properties: Record<string, string | number | boolean> = {},
  ): void {
    this.node.entities.push({ classname, placement, properties })
  }

  spawns(team: Team, options: SpawnOptions): void {
    const { count, spacing = 128, ...placement } = options
    this.node.spawns.push({ team, count, spacing, placement })
  }

  bombsite(site: Bombsite, options: BombsiteOptions = {}): void {
    const { size, ...placement } = options
    this.node.bombsites.push({ site, placement, size: size ?? null })
  }
}

export class CS2Map {
  readonly graph: MapGraph

  constructor(name: string) {
    this.graph = { name, rooms: [], placements: [], crossEdges: [] }
  }

  /** Creates the anchor room. May be called once. */
  room(spec: RoomSpec): Room {
    // Every other room is created through an existing Room, so any room at all
    // means the anchor is already among them.
    if (this.graph.rooms.length > 0) {
      throw new AuthoringError(
        'DUPLICATE_ANCHOR',
        `map "${this.graph.name}" already has an anchor room; create "${spec.name}" ` +
        'from an existing room with parent.room(spec, connection)',
        { existing: this.graph.rooms[0]?.name, attempted: spec.name },
      )
    }
    return this.createRoom(spec)
  }

  /** @internal — called by Room.room(). */
  addChild(parent: Room, spec: RoomSpec, connection: Connection): Room {
    if (!isCardinal(connection.direction)) {
      throw new AuthoringError(
        'DIAGONAL_CONNECTION',
        `connection from "${parent.name}" to "${spec.name}" uses a diagonal ` +
        'direction; only North, East, South and West may place rooms',
        { parent: parent.name, child: spec.name, direction: connection.direction },
      )
    }
    assertPositiveHeight(
      `connection from "${parent.name}" to "${spec.name}"`, connection.height,
      { parent: parent.name, child: spec.name })
    const child = this.createRoom(spec)
    this.graph.placements.push({
      parent: parent.id,
      child: child.id,
      connection: {
        direction: connection.direction,
        width: connection.width,
        length: connection.length,
        height: connection.height ?? null,
        offset: connection.offset ?? 0,
        rise: connection.rise ?? 0,
        via: connection.via ?? Transition.Ramp,
      },
    })
    return child
  }

  /** Connects two already-placed rooms, closing a cycle. */
  connect(a: Room, b: Room, opts: CrossConnection): void {
    assertPositiveHeight(
      `connection between "${a.name}" and "${b.name}"`, opts.height,
      { a: a.name, b: b.name })
    this.graph.crossEdges.push({
      a: a.id,
      b: b.id,
      width: opts.width,
      height: opts.height ?? null,
      via: opts.via ?? Transition.Ramp,
    })
  }

  private createRoom(spec: RoomSpec): Room {
    if (this.graph.rooms.some((r) => r.name === spec.name)) {
      throw new AuthoringError(
        'DUPLICATE_ROOM_NAME',
        `a room named "${spec.name}" already exists`,
        { name: spec.name },
      )
    }
    const node: RoomNode = {
      id: this.graph.rooms.length,
      name: spec.name,
      size: spec.size,
      entities: [],
      spawns: [],
      bombsites: [],
    }
    this.graph.rooms.push(node)
    return new Room(node.id, node, this)
  }
}

export type { Room }
