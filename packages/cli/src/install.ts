import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toWindowsPath } from './paths'

export class PreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreflightError'
  }
}

export interface Cs2Install {
  root: string
  rootWin: string
  gameCsgo: string
  gameCsgoWin: string
  binDir: string
  resourceCompiler: string
  cs2Exe: string
}

const CS2_DIR = 'Counter-Strike Global Offensive'

const exists = (p: string) => access(p).then(() => true, () => false)

function describe(root: string): Cs2Install {
  const binDir = join(root, 'game', 'bin', 'win64')
  return {
    root,
    rootWin: toWindowsPath(root),
    gameCsgo: join(root, 'game', 'csgo'),
    gameCsgoWin: toWindowsPath(join(root, 'game', 'csgo')),
    binDir,
    resourceCompiler: join(binDir, 'resourcecompiler.exe'),
    cs2Exe: join(binDir, 'cs2.exe'),
  }
}

async function steamLibraryRoots(): Promise<string[]> {
  const candidates = [
    '/mnt/c/Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
    '/mnt/d/SteamLibrary/steamapps/libraryfolders.vdf',
  ]
  const roots: string[] = []
  for (const vdf of candidates) {
    if (!(await exists(vdf))) continue
    const text = await readFile(vdf, 'utf8')
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
  if (explicit) {
    if (!(await exists(explicit))) {
      throw new PreflightError(`CS2 directory "${explicit}" does not exist`)
    }
    return describe(explicit)
  }

  const searched = [
    `/mnt/c/Program Files (x86)/Steam/steamapps/common/${CS2_DIR}`,
    ...(await steamLibraryRoots()),
  ]
  for (const root of searched) {
    if (await exists(join(root, 'game', 'bin', 'win64'))) return describe(root)
  }

  throw new PreflightError(
    'could not find a Counter-Strike 2 install. Looked in:\n' +
    searched.map((p) => `  ${p}`).join('\n') +
    '\nSet CS2TS_CS2_DIR or pass --cs2-dir to point at it explicitly.',
  )
}

export async function preflight(install: Cs2Install, addon?: string): Promise<void> {
  for (const [label, path] of [
    ['resourcecompiler.exe', install.resourceCompiler],
    ['vrad3.exe', join(install.binDir, 'vrad3.exe')],
    ['cs2.exe', install.cs2Exe],
  ] as const) {
    if (!(await exists(path))) {
      throw new PreflightError(
        `${label} is missing from ${install.binDir}.\n` +
        'Install the Counter-Strike 2 Workshop Tools: in Steam, right-click ' +
        'Counter-Strike 2 > Properties > Installed Files > ' +
        'Install Counter-Strike 2 Workshop Tools.',
      )
    }
  }

  if (addon) {
    const contentDir = join(install.root, 'content', 'csgo_addons', addon)
    if (!(await exists(contentDir))) {
      throw new PreflightError(
        `addon "${addon}" does not exist at ${contentDir}.\n` +
        `Create it with: cs2ts init ${addon}`,
      )
    }
  }
}
