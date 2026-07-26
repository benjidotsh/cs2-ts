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
    if (message.includes('@cs2-ts/sdk')) {
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
    throw new Error(
      map === undefined
        ? `${file} has no default export. Add: export default map`
        : `${file}'s default export has type ${
            (map as object)?.constructor?.name ?? typeof map
          }, not CS2Map. Export the value returned by new CS2Map(...).`,
    )
  }
  return map
}
