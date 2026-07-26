import { Direction } from '../../src/types'
import type { Solid, Vec3, WedgeSolid } from '../../src/types'

/**
 * A conservative "does the playable space leak?" analyser.
 *
 * Ray-marching in the four cardinal directions from a room centre — what the
 * original seal check did — only ever finds leaks that happen to lie on one
 * of four straight lines at one height. Real leaks in this SDK are corner
 * slots and under-floor voids you reach by stepping sideways first, so the
 * oracle has to be a flood fill, not a ray.
 *
 * The fill runs on the *non-uniform* grid induced by every solid's own
 * boundary planes rather than a fixed-resolution lattice. That makes it both
 * fast (a two-room map is a few thousand cells) and exact for axis-aligned
 * boxes: inside one cell no box boundary can pass, so testing the cell centre
 * decides the whole cell. There is no resolution to tune and nothing to
 * tunnel through.
 *
 * Wedges (ramps) are the one non-box shape. They are *under*-approximated by
 * inscribed steps of at most `WEDGE_STEP` units of rise, so the analyser
 * never claims sloped air is solid — it can only ever over-report leaks,
 * never miss one. `WEDGE_STEP` is kept below the floor slab thickness so the
 * sliver of air left above each inscribed step can't reach under the slab of
 * the room the ramp lands on and invent a leak that isn't there.
 */

interface Box { min: Vec3; max: Vec3 }

/** How far past the outermost geometry the "outside" shell sits. */
const PAD = 128
const WEDGE_STEP = 8

function wedgeBoxes(w: WedgeSolid): Box[] {
  const axis = w.rise === Direction.East || w.rise === Direction.West ? 0 : 1
  const ascending = w.rise === Direction.East || w.rise === Direction.North
  const other: 0 | 1 = axis === 0 ? 1 : 0
  const z0 = w.min[2]!, z1 = w.max[2]!
  const a0 = w.min[axis]!, a1 = w.max[axis]!
  const n = Math.max(1, Math.ceil((z1 - z0) / WEDGE_STEP))

  const out: Box[] = []
  for (let i = 0; i < n; i++) {
    // The inscribed step's top is the slope's *lowest* height over the slice.
    const top = z0 + (z1 - z0) * (ascending ? i : n - i - 1) / n
    if (top <= z0) continue
    const min: Vec3 = [0, 0, z0]
    const max: Vec3 = [0, 0, top]
    min[axis] = a0 + (a1 - a0) * (i / n)
    max[axis] = a0 + (a1 - a0) * ((i + 1) / n)
    min[other] = w.min[other]!
    max[other] = w.max[other]!
    out.push({ min, max })
  }
  return out
}

function toBoxes(solids: readonly Solid[]): Box[] {
  const out: Box[] = []
  for (const s of solids) {
    if (s.kind === 'box') out.push({ min: s.min, max: s.max })
    else out.push(...wedgeBoxes(s))
  }
  return out.filter((b) =>
    b.max[0]! > b.min[0]! && b.max[1]! > b.min[1]! && b.max[2]! > b.min[2]!)
}

export interface SealAnalysis {
  /** null when nothing reachable from the seeds escapes the map. */
  leak: { seed: Vec3; escapeAt: Vec3 } | null
  /** True when `p` sits in air the seeds can reach. */
  reaches(p: Vec3): boolean
  /** True when `p` is strictly inside some solid. */
  solidAt(p: Vec3): boolean
}

export function analyseSeal(solids: readonly Solid[], seeds: readonly Vec3[]): SealAnalysis {
  const boxes = toBoxes(solids)
  if (boxes.length === 0) throw new Error('analyseSeal: no solids to analyse')

  // One sorted plane list per axis, wrapped in a padding plane on each side so
  // the outermost layer of cells is unambiguously "outside the map".
  const planes: number[][] = []
  const index: Array<Map<number, number>> = []
  for (let k = 0; k < 3; k++) {
    const set = new Set<number>()
    for (const b of boxes) { set.add(b.min[k]!); set.add(b.max[k]!) }
    const sorted = [...set].sort((x, y) => x - y)
    sorted.unshift(sorted[0]! - PAD)
    sorted.push(sorted[sorted.length - 1]! + PAD)
    planes.push(sorted)
    index.push(new Map(sorted.map((v, i) => [v, i])))
  }

  const n = planes.map((p) => p.length - 1) as [number, number, number]
  const cellId = (i: number, j: number, k: number) => (i * n[1] + j) * n[2] + k
  const solid = new Uint8Array(n[0] * n[1] * n[2])

  for (const b of boxes) {
    const lo = [0, 0, 0], hi = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      lo[k] = index[k]!.get(b.min[k]!)!
      hi[k] = index[k]!.get(b.max[k]!)!
    }
    for (let i = lo[0]!; i < hi[0]!; i++) {
      for (let j = lo[1]!; j < hi[1]!; j++) {
        for (let k = lo[2]!; k < hi[2]!; k++) solid[cellId(i, j, k)] = 1
      }
    }
  }

  /** Index of the cell containing `v` on axis `k`, clamped to the grid. */
  const locate = (k: number, v: number): number => {
    const p = planes[k]!
    let lo = 0, hi = p.length - 1
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (p[mid]! <= v) lo = mid; else hi = mid
    }
    return Math.min(lo, n[k]! - 1)
  }

  const cellOf = (p: Vec3): [number, number, number] =>
    [locate(0, p[0]!), locate(1, p[1]!), locate(2, p[2]!)]

  const centreOf = (i: number, j: number, k: number): Vec3 => [
    (planes[0]![i]! + planes[0]![i + 1]!) / 2,
    (planes[1]![j]! + planes[1]![j + 1]!) / 2,
    (planes[2]![k]! + planes[2]![k + 1]!) / 2,
  ]

  const visited = new Uint8Array(solid.length)
  let leak: { seed: Vec3; escapeAt: Vec3 } | null = null

  for (const seed of seeds) {
    const [si, sj, sk] = cellOf(seed)
    if (solid[cellId(si, sj, sk)]) {
      throw new Error(
        `analyseSeal: seed (${seed.join(', ')}) is inside a solid, not in open space`,
      )
    }
    const stack: Array<[number, number, number]> = [[si, sj, sk]]
    visited[cellId(si, sj, sk)] = 1

    while (stack.length > 0) {
      const [i, j, k] = stack.pop()!
      // The padding shell: anything reaching it has left the map entirely.
      if (leak === null &&
          (i === 0 || j === 0 || k === 0 ||
           i === n[0]! - 1 || j === n[1]! - 1 || k === n[2]! - 1)) {
        leak = { seed, escapeAt: centreOf(i, j, k) }
      }
      for (const [di, dj, dk] of NEIGHBOURS) {
        const a = i + di, b = j + dj, c = k + dk
        if (a < 0 || b < 0 || c < 0 || a >= n[0]! || b >= n[1]! || c >= n[2]!) continue
        const id = cellId(a, b, c)
        if (visited[id] || solid[id]) continue
        visited[id] = 1
        stack.push([a, b, c])
      }
    }
  }

  return {
    leak,
    reaches(p: Vec3): boolean {
      const [i, j, k] = cellOf(p)
      return visited[cellId(i, j, k)] === 1
    },
    solidAt(p: Vec3): boolean {
      const [i, j, k] = cellOf(p)
      return solid[cellId(i, j, k)] === 1
    },
  }
}

const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
]
