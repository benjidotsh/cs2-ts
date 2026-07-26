/** Converts a WSL `/mnt/<drive>/...` path to the Windows form the tools need. */
export function toWindowsPath(posix: string): string {
  if (/^[A-Za-z]:[\\/]/.test(posix)) return posix.replace(/\//g, '\\')

  const match = /^\/mnt\/([a-z])(\/.*)?$/i.exec(posix)
  if (!match) {
    throw new Error(
      `path "${posix}" is not reachable from Windows; the CS2 tools are Windows ` +
      'executables and can only see paths under /mnt/<drive>',
    )
  }
  const drive = match[1]!.toUpperCase()
  const rest = (match[2] ?? '').replace(/\//g, '\\')
  return `${drive}:${rest}`
}
