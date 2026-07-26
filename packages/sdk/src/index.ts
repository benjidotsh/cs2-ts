// The public surface: what someone writing a map — or an agent writing one on
// their behalf — is meant to reach for. The lowering pipeline (solve, toSolids,
// the entity and interval helpers) is deliberately not re-exported: it is how
// buildVmap does its job, not part of the job's description, and every name
// exported here is a name a reader has to rule out first.
export const VERSION = '0.1.0'

export * from './types'
export * from './errors'
export * from './map'
export { buildVmap } from './build'
