#!/usr/bin/env bun
import { basename, join } from 'node:path'
import { Command } from 'commander'
import { exists, findCs2Install, preflight } from './install'
import { addonPaths } from './addon'
import { addonName, wholeNumber } from './options'
import { emitMap, initAddon } from './commands'
import { compileMap, launchMap, type Preset } from './compile'
import { toWindowsPath } from './paths'

const program = new Command()
  .name('cs2ts')
  .description('Build Counter-Strike 2 maps from TypeScript')
  .version('0.1.0')

program.command('init')
  .description('scaffold a Counter-Strike 2 addon in the game install')
  .argument('<addon>', 'addon name to create in the CS2 install', addonName)
  .option('--cs2-dir <path>', 'path to the CS2 install')
  .action(async (addon: string, opts: { cs2Dir?: string }) => {
    const install = await findCs2Install(opts.cs2Dir)
    await preflight(install)
    const dir = await initAddon(install, addon)
    console.log(`created addon "${addon}"\n  ${dir}`)
  })

program.command('emit')
  .description('write a .vmap without compiling it')
  .argument('<file>', 'map definition module')
  .option('--out <path>', 'write the .vmap here instead of into an addon')
  .option('--addon <name>', 'addon to write into', addonName)
  .option('--cs2-dir <path>', 'path to the CS2 install')
  .action(async (file: string, opts: { out?: string; addon?: string; cs2Dir?: string }) => {
    let install
    // --out wins outright in emitMap, so with one given the addon is never
    // turned into a path. Looking the install up anyway made `emit --out x
    // --addon nope` fail on an addon it was not going to write to, and
    // demanded the Workshop Tools to produce a .vmap that needs none of them.
    if (opts.addon && !opts.out) {
      install = await findCs2Install(opts.cs2Dir)
      await preflight(install, opts.addon)
    }
    const written = await emitMap({ file, out: opts.out, install, addon: opts.addon })
    console.log(`wrote ${written}`)
  })

interface BuildOptions {
  addon: string
  cs2Dir?: string
  lightmapResolution?: number
  lightmapQuality?: number
}

/** Everything `preview` and `build` share: emit, then run the compiler. */
async function buildAddonMap(file: string, preset: Preset, opts: BuildOptions) {
  const install = await findCs2Install(opts.cs2Dir)
  await preflight(install, opts.addon)

  const written = await emitMap({ file, install, addon: opts.addon })
  console.log(`wrote ${written}`)

  await compileMap(install, preset, toWindowsPath(written), {
    lightmapMaxResolution: opts.lightmapResolution,
    lightmapVRadQuality: opts.lightmapQuality,
  })

  // Exit 0 is not proof the compiler produced anything — it reports a failed
  // resource and exits 0 all the same, which is why the integration tests read
  // its output rather than its status. The .vpk is the artefact CS2 loads, so
  // claiming success without one would send `preview` on to launch a map that
  // was never built.
  const mapName = basename(written, '.vmap')
  const vpk = join(addonPaths(install, opts.addon).gameMaps, `${mapName}.vpk`)
  if (!(await exists(vpk))) {
    throw new Error(
      `the compiler exited cleanly but wrote no ${mapName}.vpk to ${vpk}.\n` +
      'Its output is above — look for "Failed loading resource" or an error ' +
      'near the end for what it objected to.',
    )
  }
  console.log(`compiled ${mapName}`)
  return { install, mapName }
}

program.command('preview')
  .description('fast compile, then launch CS2')
  .argument('<file>', 'map definition module')
  .requiredOption('--addon <name>', 'addon to build into', addonName)
  .option('--cs2-dir <path>', 'path to the CS2 install')
  .action(async (file: string, opts: BuildOptions) => {
    const { install, mapName } = await buildAddonMap(file, 'preview', opts)
    await launchMap(install, opts.addon, mapName)
  })

program.command('build')
  .description('full compile with vis, nav and baked lighting')
  .argument('<file>', 'map definition module')
  .requiredOption('--addon <name>', 'addon to build into', addonName)
  .option('--cs2-dir <path>', 'path to the CS2 install')
  .option('--lightmap-resolution <n>', 'max lightmap resolution', wholeNumber('lightmap-resolution', 1))
  .option('--lightmap-quality <n>', 'VRAD3 quality (Hammer uses 0, 1 or 2)', wholeNumber('lightmap-quality', 0))
  .action(async (file: string, opts: BuildOptions) => {
    await buildAddonMap(file, 'production', opts)
  })

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
