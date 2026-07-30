import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { serializeVmap } from '../../src/vmap/document'
import { buildVmap } from '../../src/build'
import { solve } from '../../src/solve'
import { toSolids } from '../../src/solids'
import { finalClusterCounts, unexpectedResourceFailures } from '../support/compiler'
import { example } from '../support/example'

const CS2 = '/mnt/c/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'
const CS2_WIN = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const enabled = process.env.CS2TS_INTEGRATION === '1'

interface CompileResult {
  exitCode: number | null
  stdout: string
  vpkExists: boolean
}

/**
 * Writes `text` into a scratch addon, compiles it, and hands the result to
 * `assert`. The addon is removed afterwards even when an assertion throws —
 * this test is meant to be run when something is broken, so the failure path
 * must not litter the CS2 install.
 */
async function compileScratchMap(
  addon: string,
  mapName: string,
  text: string,
  assert: (result: CompileResult) => void,
): Promise<void> {
  await $`mkdir -p ${`${CS2}/content/csgo_addons/${addon}/maps`}`
  await $`mkdir -p ${`${CS2}/game/csgo_addons/${addon}`}`
  await Bun.write(`${CS2}/game/csgo_addons/${addon}/addoninfo.txt`,
    '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n')
  await Bun.write(`${CS2}/content/csgo_addons/${addon}/maps/${mapName}.vmap`, text)

  try {
    const result = await $`${`${CS2}/game/bin/win64/resourcecompiler.exe`} -nop4 \
      -game ${`${CS2_WIN}\\game\\csgo`} -world -phys \
      -i ${`${CS2_WIN}\\content\\csgo_addons\\${addon}\\maps\\${mapName}.vmap`}`
      .cwd(`${CS2}/game/bin/win64`).nothrow().quiet()

    assert({
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      vpkExists: await Bun.file(
        `${CS2}/game/csgo_addons/${addon}/maps/${mapName}.vpk`).exists(),
    })
  } finally {
    await $`rm -rf ${`${CS2}/content/csgo_addons/${addon}`} ${`${CS2}/game/csgo_addons/${addon}`}`
  }
}

test.if(enabled)('a generated vmap compiles to a vpk', async () => {
  const solids = [{
    kind: 'box' as const,
    min: [-256, -256, -16] as [number, number, number],
    max: [256, 256, 0] as [number, number, number],
    material: 'materials/dev/reflectivity_30.vmat',
  }]
  const text = serializeVmap({ name: 'it', solids, entities: [] })

  await compileScratchMap('cs2ts_it', 'it', text, ({ exitCode, stdout, vpkExists }) => {
    expect(exitCode).toBe(0)
    expect(vpkExists).toBe(true)

    // Exit 0 and a written vpk are NOT proof of success: a mesh with broken
    // topology compiles cleanly to an empty world. Assert real geometry.
    const clusters = finalClusterCounts(stdout)
    expect(clusters).not.toBeNull()
    expect(clusters!.meshes).toBeGreaterThan(0)
    expect(clusters!.triangles).toBeGreaterThan(0)

    // A missing/misnamed asset (e.g. a skyname CS2 doesn't ship) fails to
    // load at runtime while the compiler still exits 0 and writes a vpk.
    expect(unexpectedResourceFailures(stdout)).toEqual([])
  })
}, 300_000)

// Task 6 proved the pipeline against a lone hand-built box; this proves a
// generated *layout* (multiple rooms, a ramp, spawns) compiles too, not just
// that a single solid survives the round trip.
test.if(enabled)('a built layout compiles to a vpk with real geometry', async () => {
  const map = example()
  const text = buildVmap(map)
  // A safe floor, not an exact count: every box contributes 12 triangles and
  // every wedge 8, so this collapses hard on a broken mesh (e.g. a bad
  // half-edge twin) while still tolerating compiler-side aggregation —
  // unlike a bare `> 0`, which a mesh that lost 32 of 33 solids still clears.
  const expectedSolids = toSolids(solve(map.graph)).length

  await compileScratchMap('cs2ts_it_layout', 'layout', text,
    ({ exitCode, stdout, vpkExists }) => {
      expect(exitCode).toBe(0)
      expect(vpkExists).toBe(true)

      const clusters = finalClusterCounts(stdout)
      expect(clusters).not.toBeNull()
      expect(clusters!.meshes).toBeGreaterThanOrEqual(expectedSolids)
      expect(clusters!.triangles).toBeGreaterThanOrEqual(expectedSolids * 6)

      expect(unexpectedResourceFailures(stdout)).toEqual([])
    })
}, 300_000)
