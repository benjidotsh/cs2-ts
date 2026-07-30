import { expect, test } from 'bun:test'
import exampleMap from '../../../examples/de_example'
import { Cs2tsError } from '../src/errors'
import { CS2Map } from '../src/map'
import { isCorridor, solve } from '../src/solve'
import type { Layout, Passage } from '../src/solve'
import { toSolids } from '../src/solids'
import { CARDINALS, Direction, Transition } from '../src/types'
import type { Cardinal, Solid, Vec3 } from '../src/types'
import { wedgeSurfaceAt } from './support/wedge'

/**
 * A corridor that ramps its floor without ramping its ceiling pinches shut.
 * `connector -> aSite` in the shipped example was the case that shipped: a
 * flat 192 ceiling over a floor climbing 0 -> 128, leaving 64 units of
 * clearance where a standing player needs 72.
 *
 * The oracle here is the emitted geometry, not the solver's own numbers: at
 * each sampled column it merges every solid's z-interval and reads the gap
 * between the floor mass and the ceiling mass above it. That also asserts the
 * shape of the cross-section — exactly one floor mass, one air gap, one
 * ceiling mass — so a corridor that sealed its clearance by growing a second
 * pocket of air would fail here rather than pass on the gap alone.
 */

/** CS2's standing player hull is 72 units tall. */
const STANDING = 72

const ROOM: Vec3 = [512, 512, 192]
const VIAS = [Transition.Step, Transition.Ramp, Transition.Stairs]
const RISES = [64, 128, -64]
const LENGTH = 256

/** The disjoint z-intervals occupied by solid at column (x, y), in order. */
function solidSpansAt(all: Solid[], x: number, y: number): Array<[number, number]> {
  const raw: Array<[number, number]> = []
  for (const s of all) {
    if (x <= s.min[0]! || x >= s.max[0]!) continue
    if (y <= s.min[1]! || y >= s.max[1]!) continue
    if (s.kind === 'box') raw.push([s.min[2]!, s.max[2]!])
    else if (s.inverted) raw.push([wedgeSurfaceAt(s, x, y), s.max[2]!])
    else raw.push([s.min[2]!, wedgeSurfaceAt(s, x, y)])
  }
  raw.sort((a, b) => a[0] - b[0])

  const merged: Array<[number, number]> = []
  for (const span of raw) {
    const last = merged.at(-1)
    // 1e-6 rather than 0: stair treads and wedges meet on computed planes
    // that can differ by a few ULPs, and a sliver that thin is not a gap.
    if (last && span[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], span[1])
    else merged.push([span[0], span[1]])
  }
  return merged
}

interface Clearance { min: number; at: number; spans: number }

/** Walks a corridor end to end, reading the gap over the walking surface. */
function clearanceAlong(solids: Solid[], passage: Passage): Clearance {
  const axis = passage.axis
  const other: 0 | 1 = axis === 0 ? 1 : 0
  const a0 = passage.bounds.min[axis]!
  const a1 = passage.bounds.max[axis]!
  const centre = (passage.bounds.min[other]! + passage.bounds.max[other]!) / 2

  const STEPS = 400
  // Sample cell midpoints, inset from both ends: a column landing exactly on
  // a solid's boundary plane — the end of the run, or the joint between two
  // stair treads — is inside neither neighbour under a strict test, and would
  // read as a missing floor rather than as the surface that is really there.
  const inset = (a1 - a0) * 0.002
  let worst = Infinity
  let worstAt = a0
  let maxSpans = 0

  for (let i = 0; i < STEPS; i++) {
    const pos = a0 + inset + (a1 - a0 - 2 * inset) * ((i + 0.5) / STEPS)
    const x = axis === 0 ? pos : centre
    const y = axis === 0 ? centre : pos
    const spans = solidSpansAt(solids, x, y)
    maxSpans = Math.max(maxSpans, spans.length)
    if (spans.length < 2) { worst = -Infinity; worstAt = pos; continue }
    const gap = spans[1]![0] - spans[0]![1]
    if (gap < worst) { worst = gap; worstAt = pos }
  }
  return { min: worst, at: worstAt, spans: maxSpans }
}

function corridors(layout: Layout): Passage[] {
  return layout.passages.filter(isCorridor)
}

test.each([...CARDINALS])(
  'a rise-bearing corridor keeps a standing player\'s clearance, facing %s',
  (direction) => {
    const failures: string[] = []
    let accepted = 0

    for (const via of VIAS) {
      for (const rise of RISES) {
        const map = new CS2Map('t')
        const a = map.room({ name: 'a', size: [...ROOM] })
        a.room({ name: 'b', size: [...ROOM] },
          { direction, width: 192, length: LENGTH, rise, via })

        let layout: Layout
        try {
          layout = solve(map.graph)
        } catch (error) {
          // A layout the solver refuses to build cannot pinch shut.
          if (error instanceof Cs2tsError) continue
          throw error
        }
        accepted++

        const solids = toSolids(layout)
        for (const passage of corridors(layout)) {
          const c = clearanceAlong(solids, passage)
          const label = `${via} rise=${rise}`
          if (c.spans !== 2) {
            failures.push(`${label}: ${c.spans} solid masses in the cross-section, expected 2`)
          }
          if (c.min < STANDING) {
            failures.push(`${label}: ${c.min.toFixed(1)} units of clearance at ${c.at.toFixed(0)}`)
          }
        }
      }
    }

    // Step refuses the 128-unit rise; ramps and stairs take all three. A
    // guard that started rejecting layouts wholesale would empty the sweep.
    expect(accepted).toBe(8)
    expect(failures).toEqual([])
  },
)

test('every corridor in the shipped example clears a standing player', () => {
  const layout = solve(exampleMap.graph)
  const solids = toSolids(layout)
  const names = new Map(layout.rooms.map((r) => [r.id, r.name]))
  const list = corridors(layout)
  expect(list.length).toBeGreaterThan(0)

  const measured = list.map((p) => {
    const c = clearanceAlong(solids, p)
    return {
      corridor: `${names.get(p.from)} -> ${names.get(p.to)}`,
      clearance: Number(c.min.toFixed(1)),
      masses: c.spans,
    }
  })
  // Reported as a list rather than a count so a failure names the corridor.
  expect(measured.filter((m) => m.clearance < STANDING || m.masses !== 2)).toEqual([])
})
