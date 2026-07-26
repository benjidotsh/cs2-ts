import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { serializeVmap } from '../../src/vmap/document'
import { buildVmap } from '../../src/build'
import { CS2Map } from '../../src/map'
import { solve } from '../../src/solve'
import { toSolids } from '../../src/solids'
import { Direction, Team } from '../../src/types'

const CS2 = '/mnt/c/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'
const CS2_WIN = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const ADDON = 'cs2ts_it'
const enabled = process.env.CS2TS_INTEGRATION === '1'

/**
 * The compiler prints "Building render clusters..." once per visibility split
 * pass — for anything beyond a single trivial solid it does this more than
 * once, and only the last line carries the real final counts; earlier ones
 * are transiently "0 meshes, 0 triangles". Taking the first match (as opposed
 * to the last) looks correct against a lone box, where there's only one line,
 * but silently reports the wrong (empty) pass against a real layout.
 */
function finalClusterCounts(stdout: string): { meshes: number; triangles: number } | null {
  const matches = [...stdout.matchAll(/Building render clusters\.\.\. (\d+) meshes, (\d+) triangles/g)]
  const last = matches.at(-1)
  return last ? { meshes: Number(last[1]), triangles: Number(last[2]) } : null
}

/**
 * The compiler reports "Failed loading resource ..." for any asset it can't
 * open — including a bad skyname/material path, which is exactly the class
 * of bug this guards against. This install unconditionally fails to load
 * "scripts/detail_prop_types.vdata_c" on every single compile, verified
 * against a bare box with zero entities that references no skybox or custom
 * material at all — it's engine-startup noise specific to this dev install,
 * not something any generated vmap could cause or fix. It's excluded by name
 * so the check still catches every other resource failure, rather than
 * failing unconditionally regardless of the SDK's output.
 */
function unexpectedResourceFailures(stdout: string): string[] {
  const failures = stdout.match(/Failed loading resource "[^"]+"/g) ?? []
  return failures.filter((f) => !f.includes('detail_prop_types.vdata_c'))
}

// Mirrors build.test.ts's example() — kept local rather than imported so that
// targeting this file alone doesn't also pull in and re-run build.test.ts's
// own unit tests (bun re-executes a test file's top-level test() calls under
// whichever file imports it).
function example() {
  const map = new CS2Map('de_example')
  const t = map.room({ name: 'tSpawn', size: [1024, 768, 192] })
  const mid = t.room({ name: 'mid', size: [1536, 1024, 256] },
    { direction: Direction.North, width: 192, length: 512 })
  mid.room({ name: 'aSite', size: [1024, 1024, 256] },
    { direction: Direction.East, width: 256, length: 384, rise: 128 })
  t.spawns(Team.T, { count: 5, facing: Direction.North })
  return map
}

test.if(enabled)('a generated vmap compiles to a vpk', async () => {
  const solids = [{
    kind: 'box' as const,
    min: [-256, -256, -16] as [number, number, number],
    max: [256, 256, 0] as [number, number, number],
    material: 'materials/dev/reflectivity_30.vmat',
  }]
  const text = serializeVmap({ name: 'it', solids, entities: [] })

  await $`mkdir -p ${`${CS2}/content/csgo_addons/${ADDON}/maps`}`
  await $`mkdir -p ${`${CS2}/game/csgo_addons/${ADDON}`}`
  await Bun.write(`${CS2}/game/csgo_addons/${ADDON}/addoninfo.txt`,
    '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n')
  await Bun.write(`${CS2}/content/csgo_addons/${ADDON}/maps/it.vmap`, text)

  try {
    const result = await $`${`${CS2}/game/bin/win64/resourcecompiler.exe`} -nop4 \
      -game ${`${CS2_WIN}\\game\\csgo`} -world -phys \
      -i ${`${CS2_WIN}\\content\\csgo_addons\\${ADDON}\\maps\\it.vmap`}`
      .cwd(`${CS2}/game/bin/win64`).nothrow().quiet()

    expect(result.exitCode).toBe(0)
    expect(await Bun.file(`${CS2}/game/csgo_addons/${ADDON}/maps/it.vpk`).exists()).toBe(true)

    const stdout = result.stdout.toString()

    // Exit 0 and a written vpk are NOT proof of success: a mesh with broken
    // topology compiles cleanly to an empty world. Assert real geometry.
    const clusters = finalClusterCounts(stdout)
    expect(clusters).not.toBeNull()
    expect(clusters!.meshes).toBeGreaterThan(0)
    expect(clusters!.triangles).toBeGreaterThan(0)

    // A missing/misnamed asset (e.g. a skyname CS2 doesn't ship) fails to
    // load at runtime while the compiler still exits 0 and writes a vpk.
    expect(unexpectedResourceFailures(stdout)).toEqual([])
  } finally {
    // Runs even when an assertion throws — this test is meant to be run when
    // something is broken, so the failure path must not litter the CS2 install.
    await $`rm -rf ${`${CS2}/content/csgo_addons/${ADDON}`} ${`${CS2}/game/csgo_addons/${ADDON}`}`
  }
}, 300_000)

// Task 6 proved the pipeline against a lone hand-built box; this proves a
// generated *layout* (multiple rooms, a ramp, spawns) compiles too, not just
// that a single solid survives the round trip.
const ADDON_LAYOUT = 'cs2ts_it_layout'

test.if(enabled)('a built layout compiles to a vpk with real geometry', async () => {
  const map = example()
  const text = buildVmap(map)
  // A safe floor, not an exact count: every box contributes 12 triangles and
  // every wedge 8, so this collapses hard on a broken mesh (e.g. a bad
  // half-edge twin) while still tolerating compiler-side aggregation —
  // unlike a bare `> 0`, which a mesh that lost 32 of 33 solids still clears.
  const expectedSolids = toSolids(solve(map.graph)).length

  await $`mkdir -p ${`${CS2}/content/csgo_addons/${ADDON_LAYOUT}/maps`}`
  await $`mkdir -p ${`${CS2}/game/csgo_addons/${ADDON_LAYOUT}`}`
  await Bun.write(`${CS2}/game/csgo_addons/${ADDON_LAYOUT}/addoninfo.txt`,
    '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n')
  await Bun.write(`${CS2}/content/csgo_addons/${ADDON_LAYOUT}/maps/layout.vmap`, text)

  try {
    const result = await $`${`${CS2}/game/bin/win64/resourcecompiler.exe`} -nop4 \
      -game ${`${CS2_WIN}\\game\\csgo`} -world -phys \
      -i ${`${CS2_WIN}\\content\\csgo_addons\\${ADDON_LAYOUT}\\maps\\layout.vmap`}`
      .cwd(`${CS2}/game/bin/win64`).nothrow().quiet()

    expect(result.exitCode).toBe(0)
    expect(await Bun.file(`${CS2}/game/csgo_addons/${ADDON_LAYOUT}/maps/layout.vpk`).exists())
      .toBe(true)

    const stdout = result.stdout.toString()

    // Same non-empty-world reasoning as above, but a bare `> 0` is too weak
    // once the map has real content: a broken mesh that drops 32 of 33
    // solids still clears `> 0`. Assert against what the SDK actually
    // produced instead.
    const clusters = finalClusterCounts(stdout)
    expect(clusters).not.toBeNull()
    expect(clusters!.meshes).toBeGreaterThanOrEqual(expectedSolids)
    expect(clusters!.triangles).toBeGreaterThanOrEqual(expectedSolids * 6)

    // A missing/misnamed asset (e.g. a skyname CS2 doesn't ship) fails to
    // load at runtime while the compiler still exits 0 and writes a vpk.
    expect(unexpectedResourceFailures(stdout)).toEqual([])
  } finally {
    await $`rm -rf ${`${CS2}/content/csgo_addons/${ADDON_LAYOUT}`} ${`${CS2}/game/csgo_addons/${ADDON_LAYOUT}`}`
  }
}, 300_000)
