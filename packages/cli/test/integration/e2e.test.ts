import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { join } from 'node:path'
// Reaching into the SDK's internals on purpose: solve() and toSolids() are
// not part of its public surface, but this test needs the solid count the
// compiler is supposed to turn into meshes.
import { solve } from '../../../sdk/src/solve'
import { toSolids } from '../../../sdk/src/solids'
import {
  finalClusterCounts, unexpectedResourceFailures,
} from '../../../sdk/test/support/compiler'
import exampleMap from '../../../../examples/de_example'
import { findCs2Install, preflight } from '../../src/install'
import { addonPaths } from '../../src/addon'
import { initAddon, emitMap } from '../../src/commands'
import { compilerArgs } from '../../src/compile'
import { toWindowsPath } from '../../src/paths'

const enabled = process.env.CS2TS_INTEGRATION === '1'
const ADDON = 'cs2ts_e2e'

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
  // Through addonPaths, like src does: this cleanup runs against the real CS2
  // install, so a layout change must not leave it quietly deleting nothing.
  const paths = addonPaths(install, ADDON)

  try {
    const written = await emitMap({
      file: join(import.meta.dir, '../../../../examples/de_example.ts'),
      install, addon: ADDON,
    })

    const args = compilerArgs('preview', install, toWindowsPath(written))
    const result = await $`${install.resourceCompiler} ${args}`
      .cwd(install.binDir).nothrow().quiet()

    expect(result.exitCode).toBe(0)

    const vpk = join(paths.gameMaps, 'de_example.vpk')
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
    await $`rm -rf ${paths.content} ${paths.game}`
  }
}, 600_000)
