import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildVmap } from '@cs2-ts/sdk'
import { addonPaths, assertSafeName } from './addon'
import type { Cs2Install } from './install'
import { loadMap } from './load'

const ADDONINFO = '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n'

export async function initAddon(
  install: Pick<Cs2Install, 'root'>,
  addon: string,
): Promise<string> {
  const paths = addonPaths(install, addon)

  await Promise.all([
    mkdir(paths.maps, { recursive: true }),
    mkdir(join(paths.game, 'maps'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(paths.maps, '.keep'), ''),
    writeFile(join(paths.game, 'addoninfo.txt'), ADDONINFO),
  ])

  return paths.content
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
  const text = buildVmap(map)

  const target = opts.out ?? (opts.install && opts.addon
    ? join(addonPaths(opts.install, opts.addon).maps, `${map.graph.name}.vmap`)
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
