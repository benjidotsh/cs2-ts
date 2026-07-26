import { spawn } from 'node:child_process'
import type { Cs2Install } from './install'

export type Preset = 'preview' | 'production'

export interface LightingOptions {
  lightmapMaxResolution?: number
  lightmapVRadQuality?: number
}

export function compilerArgs(
  preset: Preset,
  install: Cs2Install,
  vmapWin: string,
  opts: LightingOptions = {},
): string[] {
  const args = ['-nop4', '-game', install.gameCsgoWin, '-world', '-phys']
  if (preset === 'production') {
    args.push(
      '-vis', '-nav', '-bakelighting',
      '-lightmapMaxResolution', String(opts.lightmapMaxResolution ?? 1024),
      '-lightmapVRadQuality', String(opts.lightmapVRadQuality ?? 1),
    )
  }
  args.push('-i', vmapWin)
  return args
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

export async function compileMap(
  install: Cs2Install,
  preset: Preset,
  vmapWin: string,
  opts?: LightingOptions,
): Promise<void> {
  await run(install.resourceCompiler, compilerArgs(preset, install, vmapWin, opts),
    install.binDir)
}

/** Launches CS2 into the addon. -insecure disables VAC for this session. */
export async function launchMap(
  install: Cs2Install,
  addon: string,
  mapName: string,
): Promise<void> {
  try {
    await run(install.cs2Exe, ['-addon', addon, '-insecure', '+map', mapName],
      install.binDir)
  } catch (cause) {
    // A refusal to start arrives as a plain nonzero exit, so this can only
    // suggest. FACEIT AC is named because it's the one confirmed to do it.
    throw new Error(
      `the map compiled, but CS2 would not start (${install.cs2Exe}).\n` +
      'A running anti-cheat can refuse this — FACEIT AC blocks any process named ' +
      'cs2.exe while its service runs. Close it and retry.',
      { cause },
    )
  }
}
