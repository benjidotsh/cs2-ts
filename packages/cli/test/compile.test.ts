import { expect, test } from 'bun:test'
import { compilerArgs, launchMap } from '../src/compile'

const install = {
  root: '/mnt/c/cs2', gameCsgoWin: 'C:\\cs2\\game\\csgo',
  binDir: '', resourceCompiler: '', cs2Exe: '',
}

test('preview skips lighting and vis', () => {
  const args = compilerArgs('preview', install, 'C:\\m.vmap')
  expect(args).toEqual([
    '-nop4', '-game', 'C:\\cs2\\game\\csgo', '-world', '-phys', '-i', 'C:\\m.vmap',
  ])
})

test('production bakes lighting at Hammer defaults', () => {
  const args = compilerArgs('production', install, 'C:\\m.vmap')
  expect(args).toContain('-vis')
  expect(args).toContain('-nav')
  expect(args).toContain('-bakelighting')
  expect(args.join(' ')).toContain('-lightmapMaxResolution 1024')
  expect(args.join(' ')).toContain('-lightmapVRadQuality 1')
})

test('a failed launch reports the compile survived, and keeps the cause', async () => {
  const broken = { ...install, binDir: '/tmp', cs2Exe: '/tmp/cs2-does-not-exist.exe' }
  const error = await launchMap(broken, 'my_addon', 'de_test')
    .then(() => undefined, (e: unknown) => e as Error)

  expect(error).toBeDefined()
  expect(error!.message).toContain('the map compiled')
  expect((error as Error & { cause?: unknown }).cause).toBeDefined()
})

test('lighting settings are overridable', () => {
  const args = compilerArgs('production', install, 'C:\\m.vmap',
    { lightmapMaxResolution: 4096, lightmapVRadQuality: 2 })
  expect(args.join(' ')).toContain('-lightmapMaxResolution 4096')
  expect(args.join(' ')).toContain('-lightmapVRadQuality 2')
})

test('a lightmap quality of 0 reaches the compiler as 0, not as the default', () => {
  // `?? 1` and not `|| 1`: 0 is a real VRAD3 level, and the CLI now accepts it.
  const args = compilerArgs('production', install, 'C:\\m.vmap',
    { lightmapMaxResolution: 512, lightmapVRadQuality: 0 })
  expect(args.join(' ')).toContain('-lightmapVRadQuality 0')
  expect(args.join(' ')).toContain('-lightmapMaxResolution 512')
})
