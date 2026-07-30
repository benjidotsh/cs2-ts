import type { Cs2tsError } from '../../src/errors'

/**
 * Runs `fn`, requires it to throw `Type`, and hands the error back for the
 * caller's own assertions. `expect(fn).toThrow(Type)` cannot reach `.code` or
 * `.detail`, which is most of what these tests pin down; anything else thrown
 * propagates, so a failure names the error that actually came out.
 */
export function thrown<T extends Cs2tsError>(
  Type: new (...args: never[]) => T,
  fn: () => unknown,
): T {
  try {
    fn()
  } catch (error) {
    if (error instanceof Type) return error
    throw error
  }
  throw new Error(`expected ${Type.name} to be thrown, but nothing was`)
}
