#!/usr/bin/env bun
import { basename } from 'node:path'
import { Command } from 'commander'
import { findCs2Install, preflight } from './install'
import { emitMap, initAddon } from './commands'
import { compileMap, launchMap, type Preset } from './compile'
import { toWindowsPath } from './paths'

const program = new Command()
  .name('cs2ts')
  .description('Build Counter-Strike 2 maps from TypeScript')
  .version('0.1.0')

program.command('init')
  .description('scaffold a Counter-Strike 2 addon in the game install')
  .argument('<addon>', 'addon name to create in the CS2 install')
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
  .option('--addon <name>', 'addon to write into')
  .option('--cs2-dir <path>', 'path to the CS2 install')
  .action(async (file: string, opts: { out?: string; addon?: string; cs2Dir?: string }) => {
    let install
    if (opts.addon) {
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

  const mapName = basename(written, '.vmap')
  console.log(`compiled ${mapName}`)
  return { install, mapName }
}

program.command('preview')
  .description('fast compile, then launch CS2')
  .argument('<file>', 'map definition module')
  .requiredOption('--addon <name>', 'addon to build into')
  .option('--cs2-dir <path>', 'path to the CS2 install')
  .action(async (file: string, opts: { addon: string; cs2Dir?: string }) => {
    const { install, mapName } = await buildAddonMap(file, 'preview', opts)
    await launchMap(install, opts.addon, mapName)
  })

program.command('build')
  .description('full compile with vis, nav and baked lighting')
  .argument('<file>', 'map definition module')
  .requiredOption('--addon <name>', 'addon to build into')
  .option('--cs2-dir <path>', 'path to the CS2 install')
  .option('--lightmap-resolution <n>', 'max lightmap resolution', Number)
  .option('--lightmap-quality <n>', 'VRAD3 quality', Number)
  .action(async (file: string, opts: BuildOptions) => {
    await buildAddonMap(file, 'production', opts)
  })

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
