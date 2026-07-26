import { expect, test } from 'bun:test'
import { Direction, type Cardinal, type Vec3 } from '../../src/types'
import { boxPolyhedron, wedgePolyhedron } from '../../src/vmap/polyhedron'
import { buildMesh } from '../../src/vmap/mesh'

const BOX = boxPolyhedron([0, 0, 0], [64, 128, 32])

const CARDINALS: Cardinal[] = [
  Direction.North, Direction.East, Direction.South, Direction.West,
]

/** Newell's method — robust across the whole loop, not just one corner triple. */
function newellNormal(positions: Vec3[], loop: number[]): Vec3 {
  const n: Vec3 = [0, 0, 0]
  for (let i = 0; i < loop.length; i++) {
    const a = positions[loop[i]!]!
    const b = positions[loop[(i + 1) % loop.length]!]!
    n[0] += (a[1] - b[1]) * (a[2] + b[2])
    n[1] += (a[2] - b[2]) * (a[0] + b[0])
    n[2] += (a[0] - b[0]) * (a[1] + b[1])
  }
  return n
}

test('box polyhedron has 8 verts and 6 outward-wound faces', () => {
  expect(BOX.positions).toHaveLength(8)
  expect(BOX.faces).toEqual([
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ])
})

test('box half-edge topology matches the derived reference', () => {
  const m = buildMesh(BOX, 'materials/dev/reflectivity_30.vmat')

  expect(m.edgeVertexIndices).toEqual([
    3, 0, 2, 3, 1, 2, 0, 1, 5, 4, 6, 5,
    7, 6, 4, 7, 5, 1, 0, 4, 6, 2, 7, 3,
  ])
  expect(m.edgeOppositeIndices).toEqual([
    1, 0, 3, 2, 5, 4, 7, 6, 9, 8, 11, 10,
    13, 12, 15, 14, 17, 16, 19, 18, 21, 20, 23, 22,
  ])
  expect(m.edgeNextIndices).toEqual([
    2, 19, 4, 22, 6, 20, 0, 16, 10, 18, 12, 17,
    14, 21, 8, 23, 9, 5, 7, 15, 11, 3, 13, 1,
  ])
  expect(m.edgeFaceIndices).toEqual([
    0, 5, 0, 4, 0, 3, 0, 2, 1, 2, 1, 3,
    1, 4, 1, 5, 2, 3, 2, 5, 3, 4, 4, 5,
  ])
  expect(m.faceEdgeIndices).toEqual([6, 14, 18, 17, 21, 23])
  expect(m.vertexEdgeIndices).toEqual([0, 5, 3, 1, 8, 9, 11, 13])
  expect(m.edgeDataIndices).toEqual([
    0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11,
  ])
  expect(m.edgeVertexDataIndices).toEqual([...Array(24).keys()])
  expect(m.vertexDataIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(m.faceDataIndices).toEqual([0, 1, 2, 3, 4, 5])
  expect(m.materials).toEqual(['materials/dev/reflectivity_30.vmat'])
  expect(m.faceMaterialIndices).toEqual([0, 0, 0, 0, 0, 0])
})

test('box satisfies the Euler characteristic', () => {
  const m = buildMesh(BOX, 'm')
  const v = m.vertexEdgeIndices.length
  const e = m.edgeVertexIndices.length / 2
  const f = m.faceEdgeIndices.length
  expect(v - e + f).toBe(2)
})

test('every half-edge is consistent with its twin, next and vertex', () => {
  for (const poly of [BOX, wedgePolyhedron([0, 0, 0], [64, 64, 64], Direction.East)]) {
    const m = buildMesh(poly, 'm')
    const n = m.edgeVertexIndices.length
    for (let h = 0; h < n; h++) {
      // twins are mutual and adjacent
      expect(m.edgeOppositeIndices[m.edgeOppositeIndices[h]!]).toBe(h)
      expect(m.edgeOppositeIndices[h]).toBe(h ^ 1)
      // next stays on the same face and closes a loop
      expect(m.edgeFaceIndices[m.edgeNextIndices[h]!]).toBe(m.edgeFaceIndices[h]!)
      // returns home in exactly the loop length, not merely some multiple
      let cur = m.edgeNextIndices[h]!
      let steps = 1
      while (cur !== h && steps < 64) { cur = m.edgeNextIndices[cur]!; steps++ }
      expect(cur).toBe(h)
      expect(steps).toBe(poly.faces[m.edgeFaceIndices[h]!]!.length)
      // the loop's predecessor ends where this half-edge starts, which is
      // where the twin points
      const prev = m.edgeNextIndices.indexOf(h)
      expect(m.edgeVertexIndices[prev]).toBe(m.edgeVertexIndices[m.edgeOppositeIndices[h]!]!)
    }
    for (let v = 0; v < m.vertexEdgeIndices.length; v++) {
      // vertexEdgeIndices[v] is an OUTGOING half-edge: its origin, i.e. the
      // destination of its twin, is v.
      const h = m.vertexEdgeIndices[v]!
      expect(m.edgeVertexIndices[m.edgeOppositeIndices[h]!]).toBe(v)
    }
  }
})

test.each(CARDINALS)('wedge rising toward %s is closed and wound outward', (rise) => {
  // Deliberately non-cubic so an axis swap would surface.
  const poly = wedgePolyhedron([0, 0, 0], [64, 96, 32], rise)
  const m = buildMesh(poly, 'm')

  const v = m.vertexEdgeIndices.length
  const e = m.edgeVertexIndices.length / 2
  const f = m.faceEdgeIndices.length
  expect([v, e, f]).toEqual([6, 9, 5])
  expect(v - e + f).toBe(2)

  const centroid: Vec3 = [0, 0, 0]
  for (const p of poly.positions) {
    centroid[0] += p[0] / poly.positions.length
    centroid[1] += p[1] / poly.positions.length
    centroid[2] += p[2] / poly.positions.length
  }

  // Every corner of every face must sit on the outward side of that face.
  for (const loop of poly.faces) {
    const n = newellNormal(poly.positions, loop)
    for (const idx of loop) {
      const p = poly.positions[idx]!
      const dot = (p[0] - centroid[0]) * n[0]
        + (p[1] - centroid[1]) * n[1]
        + (p[2] - centroid[2]) * n[2]
      expect(dot).toBeGreaterThan(0)
    }
  }

  // Exactly two vertices at the top, both on the rise side.
  const top = poly.positions.filter((p) => p[2] === 32)
  expect(top).toHaveLength(2)
  const axis = rise === Direction.East || rise === Direction.West ? 0 : 1
  const wantMax = rise === Direction.East || rise === Direction.North
  for (const p of top) expect(p[axis]).toBe(wantMax ? (axis === 0 ? 64 : 96) : 0)
})

test('face normals point outward', () => {
  const m = buildMesh(BOX, 'm')
  // face 1 is the top; every corner normal on it is +Z
  const topCorners = m.edgeFaceIndices
    .map((f, h) => (f === 1 ? h : -1))
    .filter((h) => h >= 0)
  for (const h of topCorners) {
    expect(m.normals[m.edgeVertexDataIndices[h]!]).toEqual([0, 0, 1])
  }
})

test('tangent frames stay orthogonal, including on shallow slopes', () => {
  const shallow = wedgePolyhedron([0, 0, 0], [512, 64, 16], Direction.East)
  for (const poly of [BOX, shallow]) {
    const m = buildMesh(poly, 'm')
    for (let h = 0; h < m.normals.length; h++) {
      const n = m.normals[h]!
      const t = m.tangents[h]!
      expect(Math.abs(n[0] * t[0] + n[1] * t[1] + n[2] * t[2])).toBeLessThan(1e-6)
      expect(Math.hypot(t[0], t[1], t[2])).toBeCloseTo(1, 6)
    }
  }
})
