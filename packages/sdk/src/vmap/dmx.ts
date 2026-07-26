export type DmxValue =
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'int'; value: number }
  | { kind: 'float'; value: number }
  | { kind: 'uint64'; value: string }
  | { kind: 'vector3' | 'vector4' | 'qangle' | 'color'; value: number[] }
  | { kind: 'element'; value: DmxElement | null }
  | { kind: 'element_array'; value: DmxElement[] }
  | { kind: 'int_array'; value: number[] }
  | { kind: 'string_array'; value: string[] }
  | { kind: 'vector2_array' | 'vector3_array' | 'vector4_array'; value: number[][] }

export interface DmxElement {
  type: string
  id: string
  attributes: Array<[string, DmxValue]>
}

export function element(
  type: string,
  id: string,
  attributes: Array<[string, DmxValue]>,
): DmxElement {
  return { type, id, attributes }
}

/** Fixed-notation, trailing zeros trimmed. Never exponent form. */
export function formatFloat(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError(`cannot serialize non-finite number: ${n}`)
  }
  // toFixed reverts to exponent notation at this magnitude, which Valve's
  // parser cannot read. No real map coordinate comes near it.
  if (Math.abs(n) >= 1e21) {
    throw new RangeError(`number too large to serialize as plain decimal: ${n}`)
  }
  // Integers stringify exactly and never in exponent form below 1e21, which is
  // the overwhelming majority of what a map contains: positions, normals, most
  // UVs. Going through toFixed(10) only to trim the ten zeros back off again
  // costs about a third of the whole serialization pass.
  if (Number.isInteger(n)) return n === 0 ? '0' : String(n)
  const s = n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

const vec = (v: number[]) => v.map(formatFloat).join(' ')

function scalar(value: DmxValue): string | null {
  switch (value.kind) {
    case 'string': return value.value
    case 'bool': return value.value ? '1' : '0'
    case 'int': return String(Math.trunc(value.value))
    case 'float': return formatFloat(value.value)
    case 'uint64': return value.value
    case 'vector3': case 'vector4':
    case 'qangle': case 'color':
      return vec(value.value)
    default: return null
  }
}

function arrayItems(value: DmxValue): string[] | null {
  switch (value.kind) {
    case 'int_array': return value.value.map((n) => String(Math.trunc(n)))
    case 'string_array': return value.value
    case 'vector2_array': case 'vector3_array': case 'vector4_array':
      return value.value.map(vec)
    default: return null
  }
}

function writeElement(el: DmxElement, depth: number, out: string[]): void {
  const pad = '\t'.repeat(depth)
  const inner = '\t'.repeat(depth + 1)
  out.push(`${pad}{`)
  out.push(`${inner}"id" "elementid" "${el.id}"`)

  for (const [name, value] of el.attributes) {
    const flat = scalar(value)
    if (flat !== null) {
      out.push(`${inner}"${name}" "${value.kind}" "${flat}"`)
      continue
    }

    const items = arrayItems(value)
    if (items !== null) {
      out.push(`${inner}"${name}" "${value.kind}" `)
      out.push(`${inner}[`)
      items.forEach((item, i) => {
        out.push(`${inner}\t"${item}"${i < items.length - 1 ? ',' : ''}`)
      })
      out.push(`${inner}]`)
      continue
    }

    if (value.kind === 'element') {
      if (value.value === null) {
        out.push(`${inner}"${name}" "element" ""`)
      } else {
        out.push(`${inner}"${name}" "${value.value.type}"`)
        writeElement(value.value, depth + 1, out)
        out.push('')
      }
      continue
    }

    if (value.kind === 'element_array') {
      out.push(`${inner}"${name}" "element_array" `)
      out.push(`${inner}[`)
      value.value.forEach((child, i) => {
        out.push(`${inner}\t"${child.type}"`)
        writeElement(child, depth + 2, out)
        if (i < value.value.length - 1) out[out.length - 1] += ','
      })
      out.push(`${inner}]`)
      continue
    }

    throw new Error(
      `unhandled DmxValue kind "${(value as DmxValue).kind}" for attribute "${name}"`,
    )
  }

  out.push(`${pad}}`)
}

export function serializeDocument(root: DmxElement): string {
  const out: string[] = ['<!-- dmx encoding keyvalues2 4 format vmap 40 -->']
  out.push(`"${root.type}"`)
  writeElement(root, 0, out)
  return out.join('\n') + '\n'
}
