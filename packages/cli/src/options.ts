import { assertSafeName } from './addon'

/**
 * Command-line option parsers, kept out of index.ts so they can be tested:
 * index.ts runs the program the moment it is imported, and both of these have
 * now been wrong once — a name reported as a missing install, and a quality of
 * 0 refused for being "not positive".
 *
 * They run as commander parses, before any action starts, so a bad value is
 * reported as a bad value rather than as whatever the first real step trips
 * over.
 */

export const addonName = (value: string): string => {
  assertSafeName('addon', value)
  return value
}

/**
 * A number, not a word. `Number` alone turns "high" into NaN, which then slips
 * past `?? 1024` in compilerArgs — it is not nullish — and reaches the
 * compiler as the literal argument "NaN", with the run still reported as a
 * success.
 *
 * The text is checked, not just the parsed value: `1e21` is an integer as far
 * as Number.isInteger is concerned but stringifies back as "1e+21", which is
 * the same kind of token this guard exists to keep off the command line.
 */
export const wholeNumber = (name: string, min: number) => (value: string): number => {
  const n = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min) {
    throw new Error(
      `--${name} takes a whole number of ${min} or more, not "${value}"`)
  }
  return n
}
