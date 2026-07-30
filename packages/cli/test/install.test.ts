import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PreflightError, findCs2Install, preflight } from '../src/install'
import { initAddon } from '../src/commands'

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
  await expect(preflight(install, 'nope')).rejects.toThrow(/does not exist at/)
})

test('preflight checks the game side too, not just the content side', async () => {
  // addoninfo.txt is what CS2 reads to load an addon at all. With only the
  // content side present, a build used to compile, report success and launch
  // CS2 into an addon the game cannot see. Both messages mention "cs2ts init",
  // so this asserts on the half that tells the two apart.
  const install = await fakeInstall(true)
  await initAddon(install, 'halfaddon')
  await preflight(install, 'halfaddon')

  await rm(join(install.root, 'game', 'csgo_addons', 'halfaddon'), { recursive: true })
  await expect(preflight(install, 'halfaddon')).rejects.toThrow(/no addoninfo\.txt/)
})

test('findCs2Install wraps an override outside /mnt as a PreflightError', async () => {
  // A real directory that exists but lives on the native WSL filesystem, not
  // under /mnt/<drive> — the classic "forgot the /mnt prefix" typo. This must
  // fail as PreflightError (not a bare Error from toWindowsPath) so the CLI
  // can catch one error type and print a clean message.
  const nativeDir = await mkdtemp(join(tmpdir(), 'cs2ts-native-'))
  await expect(findCs2Install(nativeDir)).rejects.toThrow(PreflightError)
  await expect(findCs2Install(nativeDir)).rejects.toThrow(/not reachable from Windows/)
})
