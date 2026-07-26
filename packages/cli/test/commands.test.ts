import { expect, test } from 'bun:test'
import { mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initAddon, emitMap } from '../src/commands'
import { loadMap } from '../src/load'

const MAP_SOURCE = `
import { CS2Map, Direction, Team } from '@cs2-ts/sdk'
const map = new CS2Map('de_fixture')
const t = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
t.room({ name: 'mid', size: [1024, 1024, 256] },
  { direction: Direction.North, width: 192, length: 512 })
t.spawns(Team.T, { count: 5, facing: Direction.North })
export default map
`

// A dynamically-imported map module resolves its own bare `@cs2-ts/sdk`
// import the same way Node/Bun resolves any bare specifier: by walking up
// node_modules from the importing file's own directory. A bare mkdtemp()
// directory under os.tmpdir() has no such ancestor, so it can never resolve
// the package on its own — that's true of any Node/Bun project, not
// something loadMap can paper over. Symlinking node_modules from this CLI
// package (which already depends on @cs2-ts/sdk) into the temp dir mimics
// what a real consuming project's node_modules looks like.
async function withSdkResolvable(dir: string): Promise<void> {
  await symlink(join(import.meta.dir, '..', 'node_modules'), join(dir, 'node_modules'))
}

test('loads a map module and returns the CS2Map', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs2ts-map-'))
  await withSdkResolvable(dir)
  const file = join(dir, 'map.ts')
  await Bun.write(file, MAP_SOURCE)
  const map = await loadMap(file)
  expect(map.graph.name).toBe('de_fixture')
})

test('rejects a module with no default export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs2ts-map-'))
  const file = join(dir, 'bad.ts')
  await Bun.write(file, 'export const x = 1')
  await expect(loadMap(file)).rejects.toThrow(`${file} has no default export. Add: export default map`)
})

test('rejects a missing map file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs2ts-map-'))
  const file = join(dir, 'nope.ts')
  await expect(loadMap(file)).rejects.toThrow(`no such map file: ${file}`)
})

test('rejects a map file whose @cs2-ts/sdk import cannot be resolved', async () => {
  // Deliberately no withSdkResolvable() here — this reproduces the same
  // bare-specifier-resolution failure the "loads a map module" test above
  // needed the node_modules symlink to avoid, so loadMap must translate it.
  const dir = await mkdtemp(join(tmpdir(), 'cs2ts-map-'))
  const file = join(dir, 'map.ts')
  await Bun.write(file, MAP_SOURCE)
  await expect(loadMap(file)).rejects.toThrow(
    `${file} imports @cs2-ts/sdk, but it could not be resolved from ${dir}.`,
  )
  await expect(loadMap(file)).rejects.toThrow('bun add @cs2-ts/sdk')
})

test('rejects a module whose default export is some other object', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs2ts-map-'))
  const file = join(dir, 'wrong.ts')
  await Bun.write(file, 'export default { hello: "world" }')
  await expect(loadMap(file)).rejects.toThrow(
    `${file}'s default export has type Object, not CS2Map. Export the value returned by new CS2Map(...).`,
  )
})

test('init creates both addon directories and addoninfo.txt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs2ts-install-'))
  const install = {
    root, rootWin: 'C:\\x', gameCsgo: '', gameCsgoWin: '',
    binDir: '', resourceCompiler: '', cs2Exe: '',
  }
  await initAddon(install, 'my_addon')
  expect(await Bun.file(join(root, 'game', 'csgo_addons', 'my_addon', 'addoninfo.txt')).exists())
    .toBe(true)
  expect(await Bun.file(join(root, 'content', 'csgo_addons', 'my_addon', 'maps', '.keep')).exists())
    .toBe(true)
})

test('a map name that is really a path is rejected before anything is written', async () => {
  // join() resolves the `..` away, so without a guard this writes the .vmap
  // clean outside the addon directory it was aimed at.
  const dir = await mkdtemp(join(tmpdir(), 'cs2ts-escape-'))
  await withSdkResolvable(dir)
  const file = join(dir, 'map.ts')
  await Bun.write(file, MAP_SOURCE.replace('de_fixture', '../../../evil'))

  const root = await mkdtemp(join(tmpdir(), 'cs2ts-install-'))
  const install = {
    root, rootWin: 'C:\\x', gameCsgo: '', gameCsgoWin: '',
    binDir: '', resourceCompiler: '', cs2Exe: '',
  }
  await expect(emitMap({ file, install, addon: 'my_addon' }))
    .rejects.toThrow('is not a usable map name')

  const escaped = join(root, 'content', 'evil.vmap')
  expect(await Bun.file(escaped).exists()).toBe(false)
})

test('an addon name that is really a path is rejected before anything is created', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs2ts-install-'))
  const install = {
    root, rootWin: 'C:\\x', gameCsgo: '', gameCsgoWin: '',
    binDir: '', resourceCompiler: '', cs2Exe: '',
  }
  await expect(initAddon(install, '../../../evil'))
    .rejects.toThrow('is not a usable addon name')
  expect(await Bun.file(join(root, 'evil', 'addoninfo.txt')).exists()).toBe(false)
})

test('emit writes a vmap to an explicit --out path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs2ts-emit-'))
  await withSdkResolvable(dir)
  const file = join(dir, 'map.ts')
  await Bun.write(file, MAP_SOURCE)
  const out = join(dir, 'de_fixture.vmap')
  const written = await emitMap({ file, out })
  expect(written).toBe(out)
  const text = await readFile(out, 'utf8')
  expect(text.startsWith('<!-- dmx encoding keyvalues2 4 format vmap 40 -->')).toBe(true)
})
