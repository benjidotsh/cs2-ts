import type { Vec2, Vec3, Vec4 } from '../types'
import type { Polyhedron } from './polyhedron'

export interface PolygonMesh {
  vertexEdgeIndices: number[]
  vertexDataIndices: number[]
  edgeVertexIndices: number[]
  edgeOppositeIndices: number[]
  edgeNextIndices: number[]
  edgeFaceIndices: number[]
  edgeDataIndices: number[]
  edgeVertexDataIndices: number[]
  faceEdgeIndices: number[]
  faceDataIndices: number[]
  materials: string[]
  faceMaterialIndices: number[]
  faceTextureScale: Vec2[]
  faceTextureAxisU: Vec4[]
  faceTextureAxisV: Vec4[]
  faceLightmapScaleBias: number[]
  positions: Vec3[]
  texcoords: Vec2[]
  normals: Vec3[]
  tangents: Vec4[]
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len === 0) return [0, 0, 0]
  const r = (n: number) => (Object.is(n / len, -0) ? 0 : n / len)
  return [r(v[0]), r(v[1]), r(v[2])]
}

/** Face normal from the first non-degenerate corner triple. */
function faceNormal(positions: Vec3[], loop: number[]): Vec3 {
  const p0 = positions[loop[0]!]!
  for (let i = 1; i + 1 < loop.length; i++) {
    const n = cross(sub(positions[loop[i]!]!, p0), sub(positions[loop[i + 1]!]!, p0))
    if (Math.hypot(n[0], n[1], n[2]) > 1e-9) return normalize(n)
  }
  throw new Error('degenerate face: all corners are collinear')
}

/** Deterministic tangent basis: prefer world up, fall back to +X at the poles. */
function faceTangent(normal: Vec3): Vec4 {
  const seed = Math.abs(normal[2]) > 0.999
    ? ([1, 0, 0] as Vec3)
    : normalize(cross([0, 0, 1], normal))
  // Remove any component along the normal — the pole fallback is only
  // approximately perpendicular for near-vertical normals.
  const d = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2]
  const t = normalize([
    seed[0] - d * normal[0],
    seed[1] - d * normal[1],
    seed[2] - d * normal[2],
  ])
  return [t[0], t[1], t[2], -1]
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** One tile per 128 units, expressed the way Hammer expresses it. */
const TEXTURE_SCALE = 1 / 128

/**
 * Planar projection onto the face's texture axes.
 *
 * Hammer keeps `texcoord = (dot(P, axisU) * scaleU, dot(P, axisV) * scaleV)`
 * exactly — verified digit for digit against the buyzone brush in Valve's own
 * template_defuse.vmap — and the compiler reads the baked texcoords *and* the
 * declared axes and scale. They therefore have to agree: the axes are what any
 * later edit resnaps the surface from, so a face that disagrees with itself
 * means one thing now and another the moment anything touches it.
 *
 * Takes the axes rather than deriving them: both are fixed for the whole face,
 * and this runs once per corner.
 */
function faceUv(position: Vec3, axisU: Vec3, axisV: Vec3): Vec2 {
  return [dot(position, axisU) * TEXTURE_SCALE, dot(position, axisV) * TEXTURE_SCALE]
}

export function buildMesh(poly: Polyhedron, material: string): PolygonMesh {
  const { positions, faces } = poly

  // Allocate half-edges in twin pairs, in order of first appearance, so that
  // edgeDataIndices[h] === h >> 1 and edgeOppositeIndices[h] === h ^ 1.
  const halfEdgeOf = new Map<number, number>()
  const destination: number[] = []
  // A numeric key over the vertex pair, rather than a template string: this
  // runs twice per half-edge, which is the busiest loop in the build.
  const key = (from: number, to: number) => from * positions.length + to

  const allocate = (from: number, to: number): number => {
    const existing = halfEdgeOf.get(key(from, to))
    if (existing !== undefined) return existing
    const h = destination.length
    halfEdgeOf.set(key(from, to), h)
    halfEdgeOf.set(key(to, from), h + 1)
    destination.push(to, from)
    return h
  }

  const faceLoops: number[][] = faces.map((loop) =>
    loop.map((_, i) => allocate(loop[i]!, loop[(i + 1) % loop.length]!)),
  )

  const count = destination.length
  const edgeNextIndices = new Array<number>(count).fill(-1)
  const edgeFaceIndices = new Array<number>(count).fill(-1)
  const faceEdgeIndices: number[] = []

  faceLoops.forEach((loop, f) => {
    loop.forEach((h, i) => {
      edgeNextIndices[h] = loop[(i + 1) % loop.length]!
      edgeFaceIndices[h] = f
    })
    // The half-edge ending at the face's first vertex is the loop's last one.
    faceEdgeIndices.push(loop[loop.length - 1]!)
  })

  // vertexEdgeIndices[v] must be a half-edge whose ORIGIN is v (an outgoing
  // edge), not one whose destination is v. origin(h) === destination[h ^ 1],
  // so scanning destinations and recording the twin gives an outgoing edge.
  const vertexEdgeIndices = new Array<number>(positions.length).fill(-1)
  for (let h = 0; h < count; h++) {
    const v = destination[h]!
    if (vertexEdgeIndices[v] === -1) vertexEdgeIndices[v] = h ^ 1
  }

  const texcoords = new Array<Vec2>(count)
  const normals = new Array<Vec3>(count)
  const tangents = new Array<Vec4>(count)
  const faceTextureScale: Vec2[] = []
  const faceTextureAxisU: Vec4[] = []
  const faceTextureAxisV: Vec4[] = []
  const faceLightmapScaleBias: number[] = []

  faces.forEach((loop, f) => {
    const normal = faceNormal(positions, loop)
    const tangent = faceTangent(normal)
    const axisU: Vec3 = [tangent[0], tangent[1], tangent[2]]
    const b = cross(normal, axisU)
    // V runs opposite the bitangent: Source's V axis points down the surface.
    const axisV: Vec3 = [-b[0], -b[1], -b[2]]

    for (const h of faceLoops[f]!) {
      normals[h] = normal
      tangents[h] = tangent
      texcoords[h] = faceUv(positions[destination[h]!]!, axisU, axisV)
    }

    faceTextureScale.push([TEXTURE_SCALE, TEXTURE_SCALE])
    faceTextureAxisU.push([axisU[0], axisU[1], axisU[2], 0])
    faceTextureAxisV.push([axisV[0], axisV[1], axisV[2], 0])
    faceLightmapScaleBias.push(0)
  })

  return {
    vertexEdgeIndices,
    vertexDataIndices: positions.map((_, i) => i),
    edgeVertexIndices: destination,
    edgeOppositeIndices: Array.from({ length: count }, (_, h) => h ^ 1),
    edgeNextIndices,
    edgeFaceIndices,
    edgeDataIndices: Array.from({ length: count }, (_, h) => h >> 1),
    edgeVertexDataIndices: Array.from({ length: count }, (_, h) => h),
    faceEdgeIndices,
    faceDataIndices: faces.map((_, i) => i),
    materials: [material],
    faceMaterialIndices: faces.map(() => 0),
    faceTextureScale,
    faceTextureAxisU,
    faceTextureAxisV,
    faceLightmapScaleBias,
    positions,
    texcoords,
    normals,
    tangents,
  }
}
