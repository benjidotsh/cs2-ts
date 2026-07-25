function hashSeed(seed: string): [number, number, number, number] {
  // FNV-1a over the seed, then four decorrelated 32-bit lanes.
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const lane = (salt: number) => (Math.imul(h ^ salt, 0x85ebca6b) >>> 0) || 0x9e3779b9
  return [lane(0x9e3779b9), lane(0x243f6a88), lane(0xb7e15162), lane(0xdeadbeef)]
}

/**
 * Deterministic RFC-4122 v4-shaped GUIDs. Same seed always yields the same
 * sequence, so serialized .vmap output is byte-stable across rebuilds.
 */
export function createGuidFactory(seed: string): () => string {
  let [x, y, z, w] = hashSeed(seed)

  const next = (): number => {
    const t = x ^ (x << 11)
    x = y; y = z; z = w
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0
    return w
  }

  const hex = (n: number, digits: number) =>
    (n >>> 0).toString(16).padStart(8, '0').slice(8 - digits)

  return () => {
    const a = next(), b = next(), c = next(), d = next()
    return [
      hex(a, 8),
      hex(b >>> 16, 4),
      '4' + hex(b, 3),
      ((8 + (c >>> 30)) & 0xf).toString(16) + hex(c, 3),
      hex(c >>> 12, 4) + hex(d, 8),
    ].join('-')
  }
}
