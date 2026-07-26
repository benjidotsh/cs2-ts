import { expect, test } from 'bun:test'
import { toWindowsPath } from '../src/paths'

test('translates WSL mount paths to Windows paths', () => {
  expect(toWindowsPath('/mnt/c/Program Files (x86)/Steam'))
    .toBe('C:\\Program Files (x86)\\Steam')
  expect(toWindowsPath('/mnt/d/games/cs2')).toBe('D:\\games\\cs2')
})

test('leaves already-Windows paths alone', () => {
  expect(toWindowsPath('C:\\Games')).toBe('C:\\Games')
})

test('rejects paths that cannot be reached from Windows', () => {
  expect(() => toWindowsPath('/home/user/maps')).toThrow(/not reachable from Windows/)
})
