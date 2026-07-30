/**
 * Readers for resourcecompiler's stdout, shared by the SDK's and the CLI's
 * integration tests. They live here, rather than as a copy in each, because a
 * support module has no top-level `test()` calls: importing it doesn't drag
 * another file's tests into the run, which is what the copies were avoiding.
 */

/**
 * The compiler prints "Building render clusters..." once per visibility split
 * pass — for anything beyond a single trivial solid it does this more than
 * once, and only the last line carries the real final counts; earlier ones
 * are transiently "0 meshes, 0 triangles". Taking the first match (as opposed
 * to the last) looks correct against a lone box, where there's only one line,
 * but silently reports the wrong (empty) pass against a real layout.
 */
export function finalClusterCounts(
  stdout: string,
): { meshes: number; triangles: number } | null {
  const matches = [...stdout.matchAll(
    /Building render clusters\.\.\. (\d+) meshes, (\d+) triangles/g)]
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
export function unexpectedResourceFailures(stdout: string): string[] {
  const failures = stdout.match(/Failed loading resource "[^"]+"/g) ?? []
  return failures.filter((f) => !f.includes('detail_prop_types.vdata_c'))
}
