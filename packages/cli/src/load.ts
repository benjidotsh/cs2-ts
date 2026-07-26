import { resolve } from 'node:path'
import { CS2Map } from '@cs2-ts/sdk'

/** Imports a user map module and returns its default-exported CS2Map. */
export async function loadMap(file: string): Promise<CS2Map> {
  const absolute = resolve(file)
  const module = await import(absolute)
  const map = module.default

  if (!(map instanceof CS2Map)) {
    throw new Error(
      `${file} must have a default export that is a CS2Map.\n` +
      "Add: export default map",
    )
  }
  return map
}
