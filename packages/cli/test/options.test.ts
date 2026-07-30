import { expect, test } from 'bun:test'
import { addonName, wholeNumber } from '../src/options'

// Both of these have been wrong once — a bad name reported as a missing
// install, and `--lightmap-quality 0` refused for not being positive — so the
// parsers live in their own module purely so this file can reach them.

test('an addon name that is a path is refused as it is parsed', () => {
  expect(addonName('my_addon-1')).toBe('my_addon-1')
  for (const bad of ['../../../evil', 'a/b', '', 'has space', 'dot.name']) {
    expect(() => addonName(bad)).toThrow('is not a usable addon name')
  }
})

test('a lightmap quality of 0 is a real VRAD3 level, not an absent one', () => {
  const quality = wholeNumber('lightmap-quality', 0)
  expect(quality('0')).toBe(0)
  expect(quality('1')).toBe(1)
  expect(quality('2')).toBe(2)
  // ...while a resolution of 0 is meaningless, so the two take different floors.
  expect(() => wholeNumber('lightmap-resolution', 1)('0'))
    .toThrow('--lightmap-resolution takes a whole number of 1 or more, not "0"')
})

test('anything that would not survive the trip to the command line is refused', () => {
  const n = wholeNumber('lightmap-resolution', 1)
  expect(n('1024')).toBe(1024)
  for (const bad of [
    'high', '', ' ', '3.5', '-1', '1024abc', '+5', '0x10', ' 5',
    // Number.isInteger says yes, String() then says "1e+21" — the exact shape
    // of token this guard exists to keep off the compiler's argv.
    '1e21', '99999999999999999999',
  ]) {
    expect(() => n(bad)).toThrow('takes a whole number of 1 or more')
  }
})
