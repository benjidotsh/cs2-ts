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
    mkdir(paths.gameMaps, { recursive: true }),
  ])
  // 'wx' rather than a plain write: re-running init on an existing addon used
  // to overwrite its addoninfo.txt, throwing away any Workshop metadata (a
  // title, tags) the author had added to it. Creating the addon is meant to
  // be the idempotent part, not a reset.
  await Promise.all([
    writeFile(join(paths.maps, '.keep'), ''),
    writeFile(paths.addoninfo, ADDONINFO, { flag: 'wx' })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      }),
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
  // An empty --out is a caller naming a file and getting it wrong, most often
  // `--out "$OUT"` with the variable unset. `??` keeps '' — it is not nullish
  // — so it used to shadow a perfectly good addon target and then report
  // "nowhere to write", of a run that had been given somewhere to write.
  // Whitespace alone is worse: it is truthy, and wrote a file named "   ".
  if (opts.out !== undefined && opts.out.trim() === '') {
    throw new Error(
      'the output path was given but empty. Pass a path to --out, or drop it ' +
      'and pass --addon <name> to write into an addon.',
    )
  }

  const map = await loadMap(opts.file)
  assertSafeName('map', map.graph.name)
  // Both names are checked here even though only one of them may go on to
  // become a path: this is the boundary the names arrive at, and "that is not
  // a usable addon name" beats whatever failure the unused name would
  // eventually cause somewhere else.
  if (opts.addon !== undefined) assertSafeName('addon', opts.addon)

  const target = opts.out ?? (opts.install && opts.addon
    ? join(addonPaths(opts.install, opts.addon).maps, `${map.graph.name}.vmap`)
    : undefined)

  if (!target) {
    throw new Error(
      'nowhere to write the .vmap. Pass --out <path>, or --addon <name> with a ' +
      'CS2 install present.',
    )
  }

  // Built only once there is somewhere to put it: this is the expensive step,
  // and "nowhere to write the .vmap" is knowable without it.
  const text = buildVmap(map)

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text)
  return target
}
