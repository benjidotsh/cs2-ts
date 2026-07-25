import { expect, test } from 'bun:test'
import { VERSION } from '../src/index'

test('sdk exports a version', () => {
  expect(VERSION).toBe('0.1.0')
})
