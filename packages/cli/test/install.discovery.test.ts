import { afterEach, expect, mock, test } from 'bun:test'
import * as fsp from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCs2Install } from '../src/install'

// These tests exercise findCs2Install's discovery order and vdf parsing
// against the real, unmodified src/install.ts by mocking node:fs/promises
// rather than editing or copying the source. Bun's mock.module patches the
// module's exports object in place, which also affects bindings already
// captured by modules that imported it earlier (e.g. install.ts's
// `access`/`readFile`) — that's what makes mocking an already-loaded module
// work at all.
//
// It also means a *named* import alias (`import { access as realAccess }`) is
// no good for capturing "the real function to restore later": a named import
// is a live ES-module binding, so once mock.module patches the export, the
// alias reflects the mock too, not the original. Copying the function off the
// namespace object (`fsp.access`) into a plain local instead takes a one-time
// value snapshot, which is immune to later mutation of the export — that is
// what actually lets afterEach put things back and keeps this file's mocks
// from leaking into other test files sharing the same `bun test` process.
const realAccess = fsp.access
const realReadFile = fsp.readFile

afterEach(async () => {
  delete process.env.CS2TS_CS2_DIR
  await mock.module('node:fs/promises', () => ({
    access: realAccess,
    readFile: realReadFile,
  }))
})

function mockFs(existing: Set<string>, vdfContents: Map<string, string>) {
  mock.module('node:fs/promises', () => ({
    access: async (p: string) => {
      if (existing.has(p)) return
      const err = new Error(`ENOENT: no such file or directory, access '${p}'`)
      throw err
    },
    readFile: async (p: string) => {
      const content = vdfContents.get(p)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${p}'`)
      }
      return content
    },
  }))
}

const DEFAULT_ROOT =
  '/mnt/c/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'
const DEFAULT_VDF = '/mnt/c/Program Files (x86)/Steam/steamapps/libraryfolders.vdf'

test('an explicit override beats CS2TS_CS2_DIR', async () => {
  const dirA = await mkdtemp(join(tmpdir(), 'cs2ts-override-'))
  const dirB = await mkdtemp(join(tmpdir(), 'cs2ts-env-'))
  process.env.CS2TS_CS2_DIR = dirB
  // Both are outside /mnt, so whichever one wins fails at the Windows-path
  // translation step and names itself in the PreflightError message — that's
  // how we tell which one findCs2Install actually picked.
  await expect(findCs2Install(dirA)).rejects.toThrow(dirA)
})

test('CS2TS_CS2_DIR beats filesystem discovery', async () => {
  const dirB = await mkdtemp(join(tmpdir(), 'cs2ts-env-'))
  process.env.CS2TS_CS2_DIR = dirB
  // No override passed and no fs mocked, so this dev machine's real CS2
  // install is genuinely reachable via the default discovery path. If the
  // env var were ignored, this would resolve successfully instead of
  // rejecting.
  await expect(findCs2Install()).rejects.toThrow(dirB)
})

test('an override naming a non-existent directory reports "does not exist"', async () => {
  await expect(findCs2Install('/mnt/z/nope-not-real-xyz')).rejects.toThrow(
    /does not exist/,
  )
})

test('a libraryfolders.vdf listing two libraries resolves to the one that has CS2', async () => {
  const vdfText =
    '"libraryfolders"\n{\n' +
    '\t"0"\n\t{\n\t\t"path"\t\t"E:\\\\Lib1"\n\t}\n' +
    '\t"1"\n\t{\n\t\t"path"\t\t"F:\\\\Lib2"\n\t}\n' +
    '}\n'

  const lib2Root =
    '/mnt/f/Lib2/steamapps/common/Counter-Strike Global Offensive'

  mockFs(
    new Set([
      DEFAULT_VDF,
      join(lib2Root, 'game', 'bin', 'win64'),
      // Deliberately NOT including the default hardcoded candidate's
      // win64 dir, and NOT including Lib1's win64 dir — Lib1 has no CS2.
    ]),
    new Map([[DEFAULT_VDF, vdfText]]),
  )

  const install = await findCs2Install()
  expect(install.root).toBe(lib2Root)
})

test('finding nothing anywhere reports "could not find" listing the searched paths', async () => {
  mockFs(new Set(), new Map())

  await expect(findCs2Install()).rejects.toThrow(
    /could not find a Counter-Strike 2 install/,
  )
  await expect(findCs2Install()).rejects.toThrow(DEFAULT_ROOT)
})

test('an empty CS2 directory is an error, not a licence to go looking', () => {
  // `override ?? env` takes '' over the environment variable, and `if (explicit)`
  // then skips it — so `--cs2-dir "$CS2_DIR"` with the variable unset used to
  // fall through to discovery and build into whatever install was on the machine.
  mockFs(new Set([DEFAULT_ROOT, join(DEFAULT_ROOT, 'game', 'bin', 'win64')]), new Map())

  for (const empty of ['', '   ']) {
    expect(findCs2Install(empty)).rejects.toThrow(/given but empty/)
  }
})
