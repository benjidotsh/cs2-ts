import { expect, test } from 'bun:test'
import { Direction } from '../../src/types'
import { boxPolyhedron, wedgePolyhedron } from '../../src/vmap/polyhedron'
import { buildMesh } from '../../src/vmap/mesh'

const BOX = boxPolyhedron([0, 0, 0], [64, 128, 32])

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
  expect(m.vertexEdgeIndices).toEqual([1, 4, 2, 0, 9, 8, 10, 12])
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
      let cur = h
      for (let i = 0; i < 12; i++) cur = m.edgeNextIndices[cur]!
      // 12 is a multiple of 3 and 4, so any tri or quad loop returns home
      expect(cur).toBe(h)
      // the loop's predecessor ends where this half-edge starts, which is
      // where the twin points
      const prev = m.edgeNextIndices.indexOf(h)
      expect(m.edgeVertexIndices[prev]).toBe(m.edgeVertexIndices[m.edgeOppositeIndices[h]!]!)
    }
    for (let v = 0; v < m.vertexEdgeIndices.length; v++) {
      expect(m.edgeVertexIndices[m.vertexEdgeIndices[v]!]).toBe(v)
    }
  }
})

test('wedge is a closed triangular prism', () => {
  const m = buildMesh(wedgePolyhedron([0, 0, 0], [64, 64, 64], Direction.East), 'm')
  const v = m.vertexEdgeIndices.length
  const e = m.edgeVertexIndices.length / 2
  const f = m.faceEdgeIndices.length
  expect([v, e, f]).toEqual([6, 9, 5])
  expect(v - e + f).toBe(2)
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
