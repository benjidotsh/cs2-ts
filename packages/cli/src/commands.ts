import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildVmap } from '@cs2-ts/sdk'
import type { Cs2Install } from './install'
import { loadMap } from './load'

const ADDONINFO = '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n'

export async function initAddon(
  install: Pick<Cs2Install, 'root'>,
  addon: string,
): Promise<string> {
  const contentMaps = join(install.root, 'content', 'csgo_addons', addon, 'maps')
  const gameDir = join(install.root, 'game', 'csgo_addons', addon)

  await mkdir(contentMaps, { recursive: true })
  await mkdir(join(gameDir, 'maps'), { recursive: true })
  await writeFile(join(contentMaps, '.keep'), '')
  await writeFile(join(gameDir, 'addoninfo.txt'), ADDONINFO)

  return join(install.root, 'content', 'csgo_addons', addon)
}

// `| undefined` is explicit rather than using `?:` because the root tsconfig
// sets exactOptionalPropertyTypes, and callers forward possibly-undefined
// commander options straight through.
export interface EmitOptions {
  file: string
  out?: string | undefined
  install?: Cs2Install | undefined
  addon?: string | undefined
}

export async function emitMap(opts: EmitOptions): Promise<string> {
  const map = await loadMap(opts.file)
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
