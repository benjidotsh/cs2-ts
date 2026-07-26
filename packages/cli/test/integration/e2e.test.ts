import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { join } from 'node:path'
import { solve, toSolids } from '@cs2-ts/sdk'
import exampleMap from '../../../../examples/de_example'
import { findCs2Install, preflight } from '../../src/install'
import { initAddon, emitMap } from '../../src/commands'
import { compilerArgs } from '../../src/compile'
import { toWindowsPath } from '../../src/paths'

const enabled = process.env.CS2TS_INTEGRATION === '1'
const ADDON = 'cs2ts_e2e'

/**
 * Same reasoning as packages/sdk/test/integration/compile.test.ts, kept as a
 * local copy rather than imported so this file doesn't pull that one's own
 * top-level tests along with it. See that file for the full explanation of
 * why the last match (not the first) is the one that carries real counts,
 * and why "detail_prop_types.vdata_c" is excluded from resource failures.
 */
function finalClusterCounts(stdout: string): { meshes: number; triangles: number } | null {
  const matches = [...stdout.matchAll(/Building render clusters\.\.\. (\d+) meshes, (\d+) triangles/g)]
  const last = matches.at(-1)
  return last ? { meshes: Number(last[1]), triangles: Number(last[2]) } : null
}

function unexpectedResourceFailures(stdout: string): string[] {
  const failures = stdout.match(/Failed loading resource "[^"]+"/g) ?? []
  return failures.filter((f) => !f.includes('detail_prop_types.vdata_c'))
}

// This drives the CLI's own public surface end to end (install discovery,
// preflight, init, emit, and the exact args `preview` builds) rather than
// hand-rolling the resourcecompiler invocation the way the SDK-level
// integration test does — that's what makes this the CLI's test and not a
// duplicate of the SDK's. Bun's $ is still used (instead of the CLI's own
// compileMap, which pipes the child's stdio straight through with `inherit`)
// so the compiler's output can be captured and checked for real geometry,
// exactly like the SDK integration test does — exit 0 and a written .vpk
// aren't proof of success on their own.
test.if(enabled)('the reference example builds to a playable vpk through the CLI', async () => {
  const install = await findCs2Install()
  await preflight(install)
  await initAddon(install, ADDON)

  try {
    const written = await emitMap({
      file: join(import.meta.dir, '../../../../examples/de_example.ts'),
      install, addon: ADDON,
    })

    const args = compilerArgs('preview', install, toWindowsPath(written))
    const result = await $`${install.resourceCompiler} ${args}`
      .cwd(install.binDir).nothrow().quiet()

    expect(result.exitCode).toBe(0)

    const vpk = join(install.root, 'game', 'csgo_addons', ADDON, 'maps', 'de_example.vpk')
    expect(await Bun.file(vpk).exists()).toBe(true)

    const stdout = result.stdout.toString()
    const expectedSolids = toSolids(solve(exampleMap.graph)).length

    const clusters = finalClusterCounts(stdout)
    expect(clusters).not.toBeNull()
    expect(clusters!.meshes).toBeGreaterThanOrEqual(expectedSolids)
    expect(clusters!.triangles).toBeGreaterThanOrEqual(expectedSolids * 6)

    expect(unexpectedResourceFailures(stdout)).toEqual([])
  } finally {
    // Runs even when an assertion throws, so a failing run doesn't leave a
    // scratch addon behind in the real CS2 install.
    await $`rm -rf ${join(install.root, 'content', 'csgo_addons', ADDON)} \
      ${join(install.root, 'game', 'csgo_addons', ADDON)}`
  }
}, 600_000)
