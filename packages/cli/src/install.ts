import { access, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { addonPaths } from './addon'
import { toWindowsPath } from './paths'

export class PreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreflightError'
  }
}

export interface Cs2Install {
  root: string
  gameCsgoWin: string
  binDir: string
  resourceCompiler: string
  cs2Exe: string
}

const CS2_DIR = 'Counter-Strike Global Offensive'
const DEFAULT_ROOT = `/mnt/c/Program Files (x86)/Steam/steamapps/common/${CS2_DIR}`

const exists = (p: string) => access(p).then(() => true, () => false)

const hasTools = (root: string) => exists(join(root, 'game', 'bin', 'win64'))

function describe(root: string): Cs2Install {
  const binDir = join(root, 'game', 'bin', 'win64')
  try {
    return {
      root,
      gameCsgoWin: toWindowsPath(join(root, 'game', 'csgo')),
      binDir,
      resourceCompiler: join(binDir, 'resourcecompiler.exe'),
      cs2Exe: join(binDir, 'cs2.exe'),
    }
  } catch {
    throw new PreflightError(
      `CS2 directory "${root}" is not reachable from Windows. The CS2 tools are ` +
      'Windows executables, so the install must live under /mnt/<drive> — a path ' +
      'inside the WSL filesystem will not work.',
    )
  }
}

async function steamLibraryRoots(): Promise<string[]> {
  const candidates = [...'cdefghijklmnopqrstuvwxyz'].flatMap((drive) => [
    `/mnt/${drive}/Program Files (x86)/Steam/steamapps/libraryfolders.vdf`,
    `/mnt/${drive}/Steam/steamapps/libraryfolders.vdf`,
    `/mnt/${drive}/SteamLibrary/steamapps/libraryfolders.vdf`,
  ])

  // Read them all at once, and take a failed read as "not there" rather than
  // probing first: every candidate is independent, and a stat across the
  // WSL/Windows boundary costs milliseconds, so 75 of them in series is the
  // slowest part of starting up.
  const texts = await Promise.all(
    candidates.map((vdf) => readFile(vdf, 'utf8').catch(() => null)))

  const roots: string[] = []
  for (const text of texts) {
    if (text === null) continue
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
      const win = m[1]!.replace(/\\\\/g, '\\')
      const drive = /^([A-Za-z]):/.exec(win)?.[1]
      if (!drive) continue
      const posix = `/mnt/${drive.toLowerCase()}${win.slice(2).replace(/\\/g, '/')}`
      roots.push(join(posix, 'steamapps', 'common', CS2_DIR))
    }
  }
  return roots
}

export async function findCs2Install(override?: string): Promise<Cs2Install> {
  const explicit = override ?? process.env.CS2TS_CS2_DIR
  // An empty value is a caller naming a directory and getting it wrong —
  // `--cs2-dir "$CS2_DIR"` with the variable unset. `if (explicit)` alone
  // would fall through to discovery and quietly build into whatever install
  // happens to be on the machine, which is not the one they asked for.
  if (explicit !== undefined && explicit.trim() === '') {
    throw new PreflightError(
      'the CS2 directory was given but empty. Pass a path to --cs2-dir, or ' +
      'set CS2TS_CS2_DIR, or leave both unset to search for the install.',
    )
  }
  if (explicit) {
    if (!(await exists(explicit))) {
      throw new PreflightError(`CS2 directory "${explicit}" does not exist`)
    }
    // Through realpath, so that a relative path or a symlink into /mnt is
    // judged on where it actually leads. Left as given, `--cs2-dir root` is
    // told it "is not reachable from Windows" — of a directory that is.
    return describe(await realpath(explicit))
  }

  // Almost every install is at the default path, so it is checked on its own
  // before the Steam library scan — which then only runs when it is needed,
  // either to find the install elsewhere or to name what was searched.
  if (await hasTools(DEFAULT_ROOT)) return describe(DEFAULT_ROOT)

  const libraries = await steamLibraryRoots()
  for (const root of libraries) {
    if (await hasTools(root)) return describe(root)
  }

  throw new PreflightError(
    'could not find a Counter-Strike 2 install. Looked in:\n' +
    [DEFAULT_ROOT, ...libraries].map((p) => `  ${p}`).join('\n') +
    '\nSet CS2TS_CS2_DIR or pass --cs2-dir to point at it explicitly.',
  )
}

export async function preflight(install: Cs2Install, addon?: string): Promise<void> {
  const required = [
    ['resourcecompiler.exe', install.resourceCompiler],
    ['vrad3.exe', join(install.binDir, 'vrad3.exe')],
    ['cs2.exe', install.cs2Exe],
  ] as const
  const present = await Promise.all(required.map(([, path]) => exists(path)))
  const missing = required.find((_, i) => !present[i])
  if (missing) {
    throw new PreflightError(
      `${missing[0]} is missing from ${install.binDir}.\n` +
      'Install the Counter-Strike 2 Workshop Tools: in Steam, right-click ' +
      'Counter-Strike 2 > Properties > Installed Files > ' +
      'Install Counter-Strike 2 Workshop Tools.',
    )
  }

  if (!addon) return

  const { content, game } = addonPaths(install, addon)
  if (!(await exists(content))) {
    throw new PreflightError(
      `addon "${addon}" does not exist at ${content}.\n` +
      `Create it with: cs2ts init ${addon}`,
    )
  }

  // The game side is checked too, and specifically addoninfo.txt: it is what
  // CS2 reads to load the addon at all. With only the content side present a
  // build compiles and reports success, and then launches into an addon the
  // game cannot see.
  const info = join(game, 'addoninfo.txt')
  if (!(await exists(info))) {
    throw new PreflightError(
      `addon "${addon}" has no addoninfo.txt at ${info}, so CS2 cannot load it.\n` +
      `Recreate it with: cs2ts init ${addon}`,
    )
  }
}
