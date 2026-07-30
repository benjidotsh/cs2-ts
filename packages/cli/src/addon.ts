import { join } from 'node:path'
import type { Cs2Install } from './install'

const SAFE_NAME = /^[A-Za-z0-9_-]+$/

/**
 * Map and addon names become path segments inside the CS2 install, and
 * `join()` quietly resolves any `..` in them away — `new CS2Map('../../evil')`
 * would have written outside the addon directory entirely. Both are names,
 * not paths, so anything that isn't one is rejected outright.
 */
export function assertSafeName(kind: 'map' | 'addon', name: string): void {
  if (SAFE_NAME.test(name)) return
  throw new Error(
    `"${name}" is not a usable ${kind} name. Use only letters, digits, underscores ` +
    `and hyphens — a ${kind} name is a single path segment inside the CS2 install, ` +
    'not a path.',
  )
}

export interface AddonPaths {
  /** Sources the compiler reads: the .vmap lives under `maps`. */
  content: string
  maps: string
  /** Compiled output, and the addoninfo.txt CS2 reads to load the addon. */
  game: string
  gameMaps: string
  addoninfo: string
}

/**
 * Where an addon's files sit inside the install — the one place the layout is
 * written down, and so the one place the name stops being a name and becomes a
 * path. Validating here means no caller can build an addon path without it.
 */
export function addonPaths(
  install: Pick<Cs2Install, 'root'>,
  addon: string,
): AddonPaths {
  assertSafeName('addon', addon)
  const content = join(install.root, 'content', 'csgo_addons', addon)
  const game = join(install.root, 'game', 'csgo_addons', addon)
  return {
    content,
    maps: join(content, 'maps'),
    game,
    gameMaps: join(game, 'maps'),
    addoninfo: join(game, 'addoninfo.txt'),
  }
}
