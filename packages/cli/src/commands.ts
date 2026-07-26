import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildVmap } from '@cs2-ts/sdk'
import type { Cs2Install } from './install'
import { loadMap } from './load'

const ADDONINFO = '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n'

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

export async function initAddon(
  install: Pick<Cs2Install, 'root'>,
  addon: string,
): Promise<string> {
  assertSafeName('addon', addon)
  const contentDir = join(install.root, 'content', 'csgo_addons', addon)
  const gameDir = join(install.root, 'game', 'csgo_addons', addon)

  await Promise.all([
    mkdir(join(contentDir, 'maps'), { recursive: true }),
    mkdir(join(gameDir, 'maps'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(contentDir, 'maps', '.keep'), ''),
    writeFile(join(gameDir, 'addoninfo.txt'), ADDONINFO),
  ])

  return contentDir
}

// `| undefined` is explicit rather than using `?:` because the root tsconfig
// sets exactOptionalPropertyTypes, and callers forward possibly-undefined
// commander options straight through.
export interface EmitOptions {
  file: string
  out?: string | undefined
  install?: Pick<Cs2Install, 'root'> | undefined
  addon?: string | undefined
}

export async function emitMap(opts: EmitOptions): Promise<string> {
  const map = await loadMap(opts.file)
  assertSafeName('map', map.graph.name)
  if (opts.addon !== undefined) assertSafeName('addon', opts.addon)
  const text = buildVmap(map)

  const target = opts.out ?? (opts.install && opts.addon
    ? join(opts.install.root, 'content', 'csgo_addons', opts.addon, 'maps',
           `${map.graph.name}.vmap`)
    : undefined)

  if (!target) {
    throw new Error(
      'nowhere to write the .vmap. Pass --out <path>, or --addon <name> with a ' +
      'CS2 install present.',
    )
  }

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text)
  return target
}
