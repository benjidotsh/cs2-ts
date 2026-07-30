import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CS2Map } from '@cs2-ts/sdk'

/** Imports a user map module and returns its default-exported CS2Map. */
export async function loadMap(file: string): Promise<CS2Map> {
  const absolute = resolve(file)

  try {
    await access(absolute)
  } catch {
    throw new Error(`no such map file: ${absolute}`)
  }

  let module: { default?: unknown }
  try {
    module = await import(absolute)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    // Matched as a whole quoted specifier, not as a substring: `bun add
    // @cs2-ts/sdk` is the right advice only when the *package* is what failed
    // to resolve. "@cs2-ts/sdk/solve" — the SDK exports "." alone, so every
    // subpath fails — resolves fine as a package and needs the real error, as
    // does any module error that merely quotes the name.
    const unresolved =
      /(?:cannot find (?:module|package)|could not resolve|failed to resolve)\s*["']@cs2-ts\/sdk["']/i
    if (unresolved.test(message)) {
      throw new Error(
        `${file} imports @cs2-ts/sdk, but it could not be resolved from ` +
        `${dirname(absolute)}.\n` +
        'A map file must sit inside a project that has the SDK installed. Run: ' +
        'bun add @cs2-ts/sdk',
      )
    }
    throw new Error(`failed to load ${file}: ${message}`)
  }

  const map = module.default
  if (!(map instanceof CS2Map)) {
    const kind = (map as object)?.constructor?.name ?? typeof map
    throw new Error(
      map === undefined
        ? `${file} has no default export. Add: export default map`
        // `instanceof` is per module instance, so a map built against a second
        // copy of the SDK fails it while being a perfectly good CS2Map. Saying
        // "has type CS2Map, not CS2Map" helps nobody; name the real problem.
        : kind === 'CS2Map'
          ? `${file} exports a CS2Map built against a different copy of ` +
            '@cs2-ts/sdk than cs2ts is using, so the two cannot recognise each ' +
            "other's objects.\nInstall one copy both can share — check for a " +
            'nested node_modules/@cs2-ts/sdk, or a version mismatch between the ' +
            'map project and the CLI.'
          : `${file}'s default export has type ${kind}, not CS2Map. ` +
            'Export the value returned by new CS2Map(...).',
    )
  }
  return map
}
