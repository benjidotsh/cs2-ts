import { expect, test } from 'bun:test'
import { compilerArgs } from '../src/compile'

const install = {
  root: '/mnt/c/cs2', rootWin: 'C:\\cs2',
  gameCsgo: '/mnt/c/cs2/game/csgo', gameCsgoWin: 'C:\\cs2\\game\\csgo',
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

test('lighting settings are overridable', () => {
  const args = compilerArgs('production', install, 'C:\\m.vmap',
    { lightmapMaxResolution: 4096, lightmapVRadQuality: 2 })
  expect(args.join(' ')).toContain('-lightmapMaxResolution 4096')
  expect(args.join(' ')).toContain('-lightmapVRadQuality 2')
})
