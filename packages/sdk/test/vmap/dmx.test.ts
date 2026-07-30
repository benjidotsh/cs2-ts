import { expect, test } from 'bun:test'
import { createGuidFactory } from '../../src/vmap/guid'
import { element, formatFloat, serializeDocument } from '../../src/vmap/dmx'

test('guid factory is deterministic and well-formed', () => {
  const a = createGuidFactory('seed')
  const b = createGuidFactory('seed')
  const c = createGuidFactory('other')
  const first = a()
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(first).toBe(b())
  expect(a()).not.toBe(first)
  expect(c()).not.toBe(first)
})

test('floats never use exponent notation and drop trailing zeros', () => {
  expect(formatFloat(1)).toBe('1')
  expect(formatFloat(0.5)).toBe('0.5')
  expect(formatFloat(-0)).toBe('0')
  expect(formatFloat(-248.0001373291)).toBe('-248.0001373291')
  expect(formatFloat(1e-7)).toBe('0.0000001')
})

// Every KV2 string is quote-delimited, so a value carrying a quote of its own
// closes the token early and the rest of the line becomes syntax: the compiler
// rejected the whole file with "Expecting '}', didn't find it!". Entity
// keyvalues are author-supplied text, so this is reachable from the public API
// with a single character.
test('strings carrying quotes, backslashes or newlines stay one token', () => {
  const guid = createGuidFactory('t')
  const root = element('CMapRootElement', guid(), [
    ['message', { kind: 'string', value: 'He said "hi" \\ and\nthen left' }],
    ['he said "what"', { kind: 'string', value: 'quoted name' }],
    ['names', { kind: 'string_array', value: ['a"b', 'c\\d'] }],
  ])
  const lines = serializeDocument(root).split('\n')

  const message = lines.find((l) => l.includes('He said'))!
  expect(message.trim())
    .toBe('"message" "string" "He said \\"hi\\" \\\\ and\\nthen left"')
  // The value stayed on one line: a raw newline would have split it in two.
  expect(lines.filter((l) => l.includes('then left'))).toHaveLength(1)
  expect(lines.find((l) => l.includes('what'))!.trim())
    .toBe('"he said \\"what\\"" "string" "quoted name"')
  expect(lines.some((l) => l.trim() === '"a\\"b",')).toBe(true)
  expect(lines.some((l) => l.trim() === '"c\\\\d"')).toBe(true)

  // Nothing anywhere may carry a bare quote inside a token.
  for (const line of lines.slice(1)) {
    expect(line.replace(/\\./g, '').split('"').length % 2).toBe(1)
  }
})

test('serializes a nested document with the vmap header', () => {
  const guid = createGuidFactory('t')
  const child = element('CMapMesh', guid(), [
    ['nodeID', { kind: 'int', value: 2 }],
    ['origin', { kind: 'vector3', value: [1, 2, 3] }],
  ])
  const root = element('CMapRootElement', guid(), [
    ['isprefab', { kind: 'bool', value: false }],
    ['children', { kind: 'element_array', value: [child] }],
    ['names', { kind: 'string_array', value: [] }],
    ['ids', { kind: 'int_array', value: [7, 8] }],
  ])
  const text = serializeDocument(root)

  expect(text.split('\n')[0]).toBe('<!-- dmx encoding keyvalues2 4 format vmap 40 -->')
  expect(text).toContain('"isprefab" "bool" "0"')
  expect(text).toContain('"origin" "vector3" "1 2 3"')
  expect(text).toContain('\t\t\t"nodeID" "int" "2"')
  expect(text).toContain('"names" "string_array" \n\t[\n\t]')
  expect(text).toContain('"ids" "int_array" \n\t[\n\t\t"7",\n\t\t"8"\n\t]')
  expect(text.endsWith('\n')).toBe(true)
})

test('rejects magnitudes toFixed would render in exponent notation', () => {
  expect(() => formatFloat(1e21)).toThrow(RangeError)
  expect(() => formatFloat(-1e21)).toThrow(RangeError)
  expect(() => formatFloat(Infinity)).toThrow(RangeError)
  expect(() => formatFloat(NaN)).toThrow(RangeError)
  // just under the threshold still serializes as plain decimal
  expect(formatFloat(9.99e20)).not.toContain('e')
  expect(formatFloat(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991')
})

test('throws on an unhandled attribute kind rather than dropping it', () => {
  const bad = element('CMapWorld', 'id-0', [
    ['mystery', { kind: 'nonexistent', value: 1 } as never],
  ])
  expect(() => serializeDocument(bad)).toThrow(/unhandled DmxValue kind/)
})
