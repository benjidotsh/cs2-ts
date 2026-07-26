import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PreflightError, preflight } from '../src/install'

async function fakeInstall(withTools: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'cs2ts-'))
  await mkdir(join(root, 'game', 'bin', 'win64'), { recursive: true })
  await mkdir(join(root, 'game', 'csgo'), { recursive: true })
  if (withTools) {
    for (const exe of ['resourcecompiler.exe', 'vrad3.exe', 'cs2.exe']) {
      await writeFile(join(root, 'game', 'bin', 'win64', exe), '')
    }
  }
  return {
    root,
    rootWin: 'C:\\fake',
    gameCsgo: join(root, 'game', 'csgo'),
    gameCsgoWin: 'C:\\fake\\game\\csgo',
    binDir: join(root, 'game', 'bin', 'win64'),
    resourceCompiler: join(root, 'game', 'bin', 'win64', 'resourcecompiler.exe'),
    cs2Exe: join(root, 'game', 'bin', 'win64', 'cs2.exe'),
  }
}

test('preflight passes on a complete install', async () => {
  await preflight(await fakeInstall(true))
})

test('preflight names the missing tool', async () => {
  const install = await fakeInstall(false)
  await expect(preflight(install)).rejects.toThrow(PreflightError)
  await expect(preflight(install)).rejects.toThrow(/resourcecompiler\.exe/)
})

test('preflight checks the addon exists when one is named', async () => {
  const install = await fakeInstall(true)
  await expect(preflight(install, 'nope')).rejects.toThrow(/cs2ts init nope/)
})
