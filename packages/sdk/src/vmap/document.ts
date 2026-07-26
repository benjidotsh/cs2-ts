import type { Solid, Vec3 } from '../types'
import { element, serializeDocument, type DmxElement, type DmxValue } from './dmx'
import { createGuidFactory } from './guid'
import { buildMesh, type PolygonMesh } from './mesh'
import { solidPolyhedron } from './polyhedron'

export interface VmapEntity {
  classname: string
  origin: Vec3
  angles: Vec3
  properties: Record<string, string | number | boolean>
  /**
   * Brush entities — anything declared `@SolidClass` in the FGD, such as
   * func_bomb_target or func_buyzone — get their volume from geometry, not
   * from keyvalues. These become `CMapMesh` children of the entity rather
   * than world geometry, exactly as Hammer writes them. Vertex positions
   * stay in world space (the entity's own origin is not applied to its
   * children), so no coordinates need rebasing.
   */
  solids?: Solid[]
}

export interface VmapInput {
  name: string
  solids: Solid[]
  entities: VmapEntity[]
}

const str = (value: string): DmxValue => ({ kind: 'string', value })
const int = (value: number): DmxValue => ({ kind: 'int', value })
const flt = (value: number): DmxValue => ({ kind: 'float', value })
const bool = (value: boolean): DmxValue => ({ kind: 'bool', value })
const v3 = (value: Vec3): DmxValue => ({ kind: 'vector3', value })
const ints = (value: number[]): DmxValue => ({ kind: 'int_array', value })
// A nested element must be wrapped as a DmxValue before it can sit in an
// attributes tuple; `element(...)` itself returns a bare DmxElement.
const elem = (value: DmxElement): DmxValue => ({ kind: 'element', value })

function stream(
  guid: () => string,
  name: string,
  flags: number,
  data: DmxValue,
): DmxElement {
  const semantic = name.split(':')[0]!
  return element('CDmePolygonMeshDataStream', guid(), [
    ['name', str(name)],
    ['standardAttributeName', str(semantic)],
    ['semanticName', str(semantic)],
    ['semanticIndex', int(0)],
    ['vertexBufferLocation', int(0)],
    ['dataStateFlags', int(flags)],
    ['subdivisionBinding', { kind: 'element', value: null }],
    ['data', data],
  ])
}

function dataArray(
  guid: () => string,
  size: number,
  streams: DmxElement[],
): DmxElement {
  return element('CDmePolygonMeshDataArray', guid(), [
    ['size', int(size)],
    ['streams', { kind: 'element_array', value: streams }],
  ])
}

function meshDataElement(guid: () => string, m: PolygonMesh): DmxElement {
  const halfEdges = m.edgeVertexIndices.length
  return element('CDmePolygonMesh', guid(), [
    ['name', str('meshData')],
    ['vertexEdgeIndices', ints(m.vertexEdgeIndices)],
    ['vertexDataIndices', ints(m.vertexDataIndices)],
    ['edgeVertexIndices', ints(m.edgeVertexIndices)],
    ['edgeOppositeIndices', ints(m.edgeOppositeIndices)],
    ['edgeNextIndices', ints(m.edgeNextIndices)],
    ['edgeFaceIndices', ints(m.edgeFaceIndices)],
    ['edgeDataIndices', ints(m.edgeDataIndices)],
    ['edgeVertexDataIndices', ints(m.edgeVertexDataIndices)],
    ['faceEdgeIndices', ints(m.faceEdgeIndices)],
    ['faceDataIndices', ints(m.faceDataIndices)],
    ['materials', { kind: 'string_array', value: m.materials }],
    ['vertexData', elem(dataArray(guid, m.positions.length, [
      stream(guid, 'position:0', 3, { kind: 'vector3_array', value: m.positions }),
    ]))],
    ['faceVertexData', elem(dataArray(guid, halfEdges, [
      stream(guid, 'texcoord:0', 1, { kind: 'vector2_array', value: m.texcoords }),
      stream(guid, 'normal:0', 1, { kind: 'vector3_array', value: m.normals }),
      stream(guid, 'tangent:0', 1, { kind: 'vector4_array', value: m.tangents }),
    ]))],
    ['edgeData', elem(dataArray(guid, halfEdges / 2, [
      stream(guid, 'flags:0', 3, ints(new Array(halfEdges / 2).fill(0))),
    ]))],
    ['faceData', elem(dataArray(guid, m.faceEdgeIndices.length, [
      stream(guid, 'textureScale:0', 0, { kind: 'vector2_array', value: m.faceTextureScale }),
      stream(guid, 'textureAxisU:0', 0, { kind: 'vector4_array', value: m.faceTextureAxisU }),
      stream(guid, 'textureAxisV:0', 0, { kind: 'vector4_array', value: m.faceTextureAxisV }),
      stream(guid, 'materialindex:0', 8, ints(m.faceMaterialIndices)),
      stream(guid, 'flags:0', 3, ints(m.faceEdgeIndices.map(() => 0))),
      stream(guid, 'lightmapScaleBias:0', 1, ints(m.faceLightmapScaleBias)),
    ]))],
    ['subdivisionData', elem(element('CDmePolygonMeshSubdivisionData', guid(), [
      ['subdivisionLevels', ints(new Array(halfEdges).fill(0))],
      ['streams', { kind: 'element_array', value: [] }],
    ]))],
  ])
}

function meshNode(guid: () => string, nodeId: number, solid: Solid): DmxElement {
  const mesh = buildMesh(solidPolyhedron(solid), solid.material)
  return element('CMapMesh', guid(), [
    ['nodeID', int(nodeId)],
    ['referenceID', { kind: 'uint64', value: '0x0' }],
    ['children', { kind: 'element_array', value: [] }],
    ['variableTargetKeys', { kind: 'string_array', value: [] }],
    ['variableNames', { kind: 'string_array', value: [] }],
    ['cubeMapName', str('')],
    ['visexclude', bool(false)],
    ['disablemerging', bool(false)],
    ['renderwithdynamic', bool(false)],
    ['disableHeightDisplacement', bool(false)],
    ['fademindist', flt(-1)],
    ['fademaxdist', flt(0)],
    ['bakelighting', bool(true)],
    ['renderToCubemaps', bool(true)],
    ['emissiveLightingEnabled', bool(true)],
    ['emissiveLightingBoost', flt(1)],
    ['disableShadows', int(0)],
    ['lightingDummy', bool(false)],
    ['keep_vertices', bool(false)],
    ['smoothingAngle', flt(40)],
    ['tintColor', { kind: 'color', value: [255, 255, 255, 255] }],
    ['renderAmt', int(255)],
    ['physicsType', str('default')],
    ['physicsGroup', str('')],
    ['physicsInteractsAs', str('')],
    ['physicsInteractsWith', str('')],
    ['physicsInteractsExclude', str('')],
    ['meshData', elem(meshDataElement(guid, mesh))],
    ['physicsSimplificationOverride', bool(false)],
    ['physicsSimplificationError', flt(0)],
    ['lightGroup', str('')],
    ['precomputelightprobes', bool(true)],
    ['origin', v3([0, 0, 0])],
    ['angles', { kind: 'qangle', value: [0, 0, 0] }],
    ['scales', v3([1, 1, 1])],
    ['transformLocked', bool(false)],
    ['force_hidden', bool(false)],
    ['editorOnly', bool(false)],
  ])
}

function emptyPlugList(guid: () => string): DmxElement {
  return element('DmePlugList', guid(), [
    ['names', { kind: 'string_array', value: [] }],
    ['dataTypes', ints([])],
    ['plugTypes', ints([])],
    ['descriptions', { kind: 'string_array', value: [] }],
  ])
}

function entityProperties(
  guid: () => string,
  classname: string,
  properties: Record<string, string | number | boolean>,
): DmxElement {
  // targetname/vscripts default to '' ahead of the caller's own properties,
  // but a caller-supplied value of the same name wins in place rather than
  // being duplicated (Map.set on an existing key keeps its original slot).
  const merged = new Map<string, string | number | boolean>([
    ['targetname', ''],
    ['vscripts', ''],
    ...Object.entries(properties),
  ])
  const attrs: Array<[string, DmxValue]> = [['classname', str(classname)]]
  // Entity keyvalues are always strings in a vmap, whatever the FGD type says.
  for (const [key, value] of merged) {
    const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
    attrs.push([key, str(text)])
  }
  return element('EditGameClassProps', guid(), attrs)
}

function entityNode(
  guid: () => string,
  nodeId: number,
  entity: VmapEntity,
  children: DmxElement[],
): DmxElement {
  return element('CMapEntity', guid(), [
    ['nodeID', int(nodeId)],
    ['referenceID', { kind: 'uint64', value: '0x0' }],
    ['children', { kind: 'element_array', value: children }],
    ['variableTargetKeys', { kind: 'string_array', value: [] }],
    ['variableNames', { kind: 'string_array', value: [] }],
    ['relayPlugData', elem(emptyPlugList(guid))],
    ['connectionsData', { kind: 'element_array', value: [] }],
    ['entity_properties', elem(entityProperties(guid, entity.classname, entity.properties))],
    ['hitNormal', v3([0, 0, 1])],
    ['isProceduralEntity', bool(false)],
    ['origin', v3(entity.origin)],
    ['angles', { kind: 'qangle', value: entity.angles }],
    ['scales', v3([1, 1, 1])],
    ['transformLocked', bool(false)],
    ['force_hidden', bool(false)],
    ['editorOnly', bool(false)],
  ])
}

export function serializeVmap(input: VmapInput): string {
  const guid = createGuidFactory(input.name)
  let nodeId = 1

  const children: DmxElement[] = []
  for (const solid of input.solids) children.push(meshNode(guid, ++nodeId, solid))
  for (const entity of input.entities) {
    // Hammer numbers a brush entity's meshes ahead of the entity itself.
    const meshes = (entity.solids ?? []).map((s) => meshNode(guid, ++nodeId, s))
    children.push(entityNode(guid, ++nodeId, entity, meshes))
  }

  const world = element('CMapWorld', guid(), [
    ['nodeID', int(1)],
    ['referenceID', { kind: 'uint64', value: '0x0' }],
    ['children', { kind: 'element_array', value: children }],
    ['variableTargetKeys', { kind: 'string_array', value: [] }],
    ['variableNames', { kind: 'string_array', value: [] }],
    ['relayPlugData', elem(emptyPlugList(guid))],
    ['connectionsData', { kind: 'element_array', value: [] }],
    ['entity_properties', elem(entityProperties(guid, 'worldspawn', {
      targetname: '',
      skyname: 'sky_day01_01',
      pvstype: '10',
      baked_light_index_min: '0',
      baked_light_index_max: '256',
      max_lightmap_resolution: '0',
      lightmap_queries: '1',
    }))],
    ['nextDecalID', int(0)],
    ['fixupEntityNames', bool(true)],
    ['mapUsageType', str('standard')],
    ['origin', v3([0, 0, 0])],
    ['angles', { kind: 'qangle', value: [0, 0, 0] }],
    ['scales', v3([1, 1, 1])],
    ['transformLocked', bool(false)],
    ['force_hidden', bool(false)],
    ['editorOnly', bool(false)],
  ])

  const root = element('CMapRootElement', guid(), [
    ['isprefab', bool(false)],
    ['editorbuild', int(10112)],
    ['editorversion', int(400)],
    ['itemFile', str('')],
    ['defaultcamera', elem(element('CStoredCamera', guid(), [
      ['position', v3([0, -1000, 1000])],
      ['lookat', v3([0, 0, 0])],
    ]))],
    ['3dcameras', elem(element('CStoredCameras', guid(), [
      ['activecamera', int(-1)],
      ['cameras', { kind: 'element_array', value: [] }],
    ]))],
    ['world', elem(world)],
    ['visbility', elem(element('CVisibilityMgr', guid(), [
      ['nodes', { kind: 'element_array', value: [] }],
      ['hiddenFlags', ints([])],
    ]))],
    ['mapVariables', elem(element('CMapVariableSet', guid(), [
      ['variableNames', { kind: 'string_array', value: [] }],
      ['variableValues', { kind: 'string_array', value: [] }],
      ['variableTypeNames', { kind: 'string_array', value: [] }],
      ['variableTypeParameters', { kind: 'string_array', value: [] }],
    ]))],
    ['rootSelectionSet', elem(element('CMapSelectionSet', guid(), [
      ['children', { kind: 'element_array', value: [] }],
      ['selectionSetName', str('')],
      ['selectionSetData', { kind: 'element', value: null }],
    ]))],
  ])

  return serializeDocument(root)
}
