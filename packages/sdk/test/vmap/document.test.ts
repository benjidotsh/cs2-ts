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

test('matches the committed golden file', async () => {
  const golden = await Bun.file(
    new URL('../fixtures/one-box.vmap', import.meta.url),
  ).text()
  expect(serializeVmap(INPUT)).toBe(golden)
})
