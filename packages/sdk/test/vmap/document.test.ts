import { expect, test } from 'bun:test'
import { serializeVmap } from '../../src/vmap/document'
import type { Solid } from '../../src/types'

const BOX: Solid = {
  kind: 'box',
  min: [-64, -64, 0],
  max: [64, 64, 16],
  material: 'materials/dev/reflectivity_30.vmat',
}

const INPUT = {
  name: 'one_box',
  solids: [BOX],
  entities: [{
    classname: 'info_player_terrorist',
    origin: [0, 0, 16] as [number, number, number],
    angles: [0, 90, 0] as [number, number, number],
    properties: { priority: 0, enabled: true },
  }],
}

test('emits a well-formed vmap document', () => {
  const text = serializeVmap(INPUT)
  expect(text.split('\n')[0]).toBe('<!-- dmx encoding keyvalues2 4 format vmap 40 -->')
  expect(text).toContain('"CMapRootElement"')
  expect(text).toContain('"world" "CMapWorld"')
  expect(text).toContain('"CMapMesh"')
  expect(text).toContain('"meshData" "CDmePolygonMesh"')
  expect(text).toContain('"name" "string" "position:0"')
  expect(text).toContain('"classname" "string" "info_player_terrorist"')
  expect(text).toContain('"classname" "string" "worldspawn"')
  expect(text).toContain('"priority" "string" "0"')
  expect(text).toContain('"enabled" "string" "1"')
})

test('an entity carrying solids emits them as child meshes, not world geometry', () => {
  const text = serializeVmap({
    name: 'brush_entity',
    solids: [BOX],
    entities: [{
      classname: 'func_bomb_target',
      origin: [0, 0, 64],
      angles: [0, 0, 0],
      properties: { bomb_site_designation: '0' },
      solids: [{
        kind: 'box',
        min: [-128, -128, 0],
        max: [128, 128, 128],
        material: 'materials/tools/toolstrigger.vmat',
      }],
    }],
  })

  // Everything from the entity's opening brace up to its classname — the
  // children array is serialized before entity_properties, so a child mesh
  // shows up in this window and a sibling world mesh does not.
  const start = text.indexOf('"CMapEntity"')
  const head = text.slice(start, text.indexOf('"classname" "string" "func_bomb_target"'))
  expect(head).toContain('"CMapMesh"')
  expect(head).toContain('materials/tools/toolstrigger.vmat')

  // ...and the trigger brush must not also have been emitted as world geometry.
  expect(text.split('materials/tools/toolstrigger.vmat')).toHaveLength(2)
  // Node IDs stay unique across world meshes, child meshes and entities.
  const ids = [...text.matchAll(/"nodeID" "int" "(\d+)"/g)].map((m) => m[1]!)
  expect(new Set(ids).size).toBe(ids.length)
})

test('matches the committed golden file', async () => {
  const golden = await Bun.file(
    new URL('../fixtures/one-box.vmap', import.meta.url),
  ).text()
  expect(serializeVmap(INPUT)).toBe(golden)
})
