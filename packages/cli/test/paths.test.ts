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

test('accepts an uppercase drive letter in the /mnt/<drive> segment', () => {
  expect(toWindowsPath('/mnt/C/Games')).toBe('C:\\Games')
})

test('preserves a trailing slash', () => {
  expect(toWindowsPath('/mnt/c/Games/')).toBe('C:\\Games\\')
})

test('translates a bare /mnt/<drive> with no path segment to a bare drive letter', () => {
  // Unreachable for a real install (there is no CS2 directly at the drive root),
  // but this documents the current, intentional behavior.
  expect(toWindowsPath('/mnt/c')).toBe('C:')
})
