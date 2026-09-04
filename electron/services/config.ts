/**
 * Comparación de configuraciones clave por clave.
 *
 * Un archivo de ajustes no se compara como un binario. Los juegos reescriben
 * sus .ini y .xml constantemente, así que saber que el archivo cambió no dice
 * nada: hay que saber qué clave cambió y de qué valor a cuál.
 *
 * Los analizadores guardan la posición exacta de cada valor dentro del texto.
 * Eso permite revertir una clave suelta editando solo esos bytes y dejando
 * intacto todo lo demás: comentarios, orden, sangrado y saltos de línea.
 *
 * Regla de oro de la escritura: después de aplicar un cambio se vuelve a
 * analizar el resultado y se comprueba que la clave tocada tiene el valor
 * pedido y que ninguna otra se ha movido. Si algo no cuadra, no se escribe.
 */

import path from 'node:path'
import type { ConfigDiff, ConfigFormat } from '../../shared/types'

export interface Field {
  key: string
  value: string
  /** Posición del valor dentro del texto original. Sin ella no hay edición quirúrgica. */
  start?: number
  end?: number
}

export interface Parsed {
  format: ConfigFormat
  fields: Map<string, Field>
  /** Si el análisis fue limpio. Si no, solo se permite restauración completa. */
  ok: boolean
  /** Si se puede revertir clave a clave conservando el formato original. */
  surgical: boolean
}

export type { ConfigDiff, ConfigFormat }

export function detectFormat(rel: string): ConfigFormat | null {
  const ext = path.extname(rel).toLowerCase()
  if (['.ini', '.cfg', '.conf', '.properties', '.settings', '.prefs', '.toml'].includes(ext)) {
    return 'ini'
  }
  if (ext === '.xml') return 'xml'
  if (ext === '.json') return 'json'
  return null
}

// ------------------------------------------------------------------- INI

function parseIni(text: string): Parsed {
  const fields = new Map<string, Field>()
  const seen = new Map<string, number>()
  let section = ''
  let pos = 0

  const put = (rawKey: string, value: string, start: number, end: number): void => {
    let key = section ? `${section}.${rawKey}` : rawKey
    const times = (seen.get(key) ?? 0) + 1
    seen.set(key, times)
    if (times > 1) key = `${key} #${times}`
    fields.set(key, { key, value, start, end })
  }

  while (pos <= text.length) {
    let nl = text.indexOf('\n', pos)
    if (nl === -1) nl = text.length
    let lineEnd = nl
    if (lineEnd > pos && text[lineEnd - 1] === '\r') lineEnd--
    const line = text.slice(pos, lineEnd)
    const trimmed = line.trim()

    if (trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
      const sec = trimmed.match(/^\[(.*)\]$/)
      if (sec) {
        section = sec[1].trim()
      } else {
        const eq = line.indexOf('=')
        if (eq > 0) {
          const rawKey = line.slice(0, eq).trim()
          if (rawKey) {
            // El valor va desde el primer carácter no blanco tras el = hasta el
            // último no blanco de la línea. Los índices son relativos a la
            // línea y se convierten a absolutos al guardarlos.
            let s = eq + 1
            while (s < line.length && (line[s] === ' ' || line[s] === '\t')) s++
            let e = line.length
            while (e > s && (line[e - 1] === ' ' || line[e - 1] === '\t')) e--
            put(rawKey, line.slice(s, e), pos + s, pos + e)
          }
        }
      }
    }
    pos = nl + 1
  }
  return { format: 'ini', fields, ok: true, surgical: true }
}

// ------------------------------------------------------------------- XML

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

export function encodeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&${Object.keys(ENTITIES).find((k) => ENTITIES[k] === c)};`)
}

/**
 * Recorrido de XML que anota dónde empieza y acaba cada valor.
 *
 * No es un analizador de propósito general: no maneja DTD ni espacios de
 * nombres. Cubre lo que se encuentra en los archivos de ajustes de un juego, y
 * ante cualquier cosa que no entienda se declara incompleto en vez de inventar.
 */
function parseXml(text: string): Parsed {
  const fields = new Map<string, Field>()
  const stack: string[] = []
  const counters: Map<string, number> = new Map()
  let ok = true
  let i = 0

  const pathOf = (): string => stack.join('.')

  const put = (key: string, value: string, start: number, end: number): void => {
    if (fields.has(key)) return
    fields.set(key, { key, value, start, end })
  }

  while (i < text.length) {
    const lt = text.indexOf('<', i)

    // Texto suelto entre etiquetas: es el valor del elemento actual.
    if (lt > i && stack.length) {
      const raw = text.slice(i, lt)
      if (raw.trim()) {
        let s = i
        while (s < lt && /\s/.test(text[s])) s++
        let e = lt
        while (e > s && /\s/.test(text[e - 1])) e--
        put(pathOf(), decodeXml(text.slice(s, e)), s, e)
      }
    }
    if (lt === -1) break
    i = lt

    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i)
      if (end === -1) {
        ok = false
        break
      }
      i = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i)
      if (end === -1) {
        ok = false
        break
      }
      if (stack.length) put(pathOf(), text.slice(i + 9, end), i + 9, end)
      i = end + 3
      continue
    }
    if (text.startsWith('<?', i) || text.startsWith('<!', i)) {
      const end = text.indexOf('>', i)
      if (end === -1) {
        ok = false
        break
      }
      i = end + 1
      continue
    }
    if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i)
      if (end === -1) {
        ok = false
        break
      }
      stack.pop()
      i = end + 1
      continue
    }

    // Etiqueta de apertura.
    const nameMatch = /^<([\w:.-]+)/.exec(text.slice(i, i + 200))
    if (!nameMatch) {
      ok = false
      break
    }
    const tag = nameMatch[1]
    let j = i + nameMatch[0].length

    // Hermanos con el mismo nombre: se numeran a partir del segundo.
    const parent = pathOf()
    const counterKey = `${parent}>${tag}`
    const n = (counters.get(counterKey) ?? 0) + 1
    counters.set(counterKey, n)
    const label = n > 1 ? `${tag}[${n}]` : tag
    stack.push(label)

    let selfClosing = false
    while (j < text.length) {
      while (j < text.length && /\s/.test(text[j])) j++
      if (text.startsWith('/>', j)) {
        selfClosing = true
        j += 2
        break
      }
      if (text[j] === '>') {
        j++
        break
      }
      const attr = /^([\w:.-]+)\s*=\s*(["'])/.exec(text.slice(j, j + 200))
      if (!attr) {
        // Atributo suelto o algo que no reconozco: sigo, pero lo anoto.
        const gt = text.indexOf('>', j)
        if (gt === -1) {
          ok = false
          break
        }
        ok = false
        j = text[gt - 1] === '/' ? ((selfClosing = true), gt + 1) : gt + 1
        break
      }
      const quote = attr[2]
      const valueStart = j + attr[0].length
      const valueEnd = text.indexOf(quote, valueStart)
      if (valueEnd === -1) {
        ok = false
        break
      }
      put(`${pathOf()}@${attr[1]}`, decodeXml(text.slice(valueStart, valueEnd)), valueStart, valueEnd)
      j = valueEnd + 1
    }

    if (selfClosing) stack.pop()
    i = j
  }

  return { format: 'xml', fields, ok, surgical: ok }
}

// ------------------------------------------------------------------ JSON

function flattenJson(value: unknown, prefix: string, into: Map<string, Field>): void {
  if (value === null || typeof value !== 'object') {
    into.set(prefix, { key: prefix, value: String(value) })
    return
  }
  if (Array.isArray(value)) {
    if (!value.length) into.set(prefix, { key: prefix, value: '[]' })
    value.forEach((v, i) => flattenJson(v, `${prefix}[${i}]`, into))
    return
  }
  const keys = Object.keys(value as Record<string, unknown>)
  if (!keys.length) into.set(prefix, { key: prefix, value: '{}' })
  for (const k of keys) {
    flattenJson((value as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, into)
  }
}

function parseJson(text: string): Parsed {
  const fields = new Map<string, Field>()
  try {
    flattenJson(JSON.parse(text), '', fields)
    // Sin posiciones no hay edición quirúrgica: JSON solo admite restauración completa.
    return { format: 'json', fields, ok: true, surgical: false }
  } catch {
    return { format: 'json', fields, ok: false, surgical: false }
  }
}

// --------------------------------------------------------------- fachada

export function parseConfig(text: string, format: ConfigFormat): Parsed {
  if (format === 'ini') return parseIni(text)
  if (format === 'xml') return parseXml(text)
  return parseJson(text)
}

export function diffConfig(before: string, after: string, format: ConfigFormat): ConfigDiff {
  const a = parseConfig(before, format)
  const b = parseConfig(after, format)
  const diff: ConfigDiff = {
    format,
    surgical: a.ok && b.surgical,
    changed: [],
    added: [],
    removed: [],
    unchanged: 0
  }
  for (const [key, field] of b.fields) {
    const old = a.fields.get(key)
    if (!old) diff.added.push({ key, value: field.value })
    else if (old.value !== field.value) diff.changed.push({ key, from: old.value, to: field.value })
    else diff.unchanged++
  }
  for (const [key, field] of a.fields) {
    if (!b.fields.has(key)) diff.removed.push({ key, value: field.value })
  }
  const byKey = (x: { key: string }, y: { key: string }) => x.key.localeCompare(y.key, 'es')
  diff.changed.sort(byKey)
  diff.added.sort(byKey)
  diff.removed.sort(byKey)
  return diff
}

/**
 * Devuelve claves concretas a su valor anterior editando solo sus bytes.
 *
 * Aplica los cambios de atrás hacia delante para que las posiciones de los
 * anteriores sigan siendo válidas, y verifica el resultado antes de devolverlo.
 * Si la verificación falla, devuelve null y nadie escribe nada.
 */
export function revertKeys(
  current: string,
  format: ConfigFormat,
  targets: { key: string; value: string }[]
): { text: string; applied: string[] } | null {
  const parsed = parseConfig(current, format)
  if (!parsed.surgical) return null

  const edits: { start: number; end: number; text: string; key: string }[] = []
  for (const target of targets) {
    const field = parsed.fields.get(target.key)
    if (!field || field.start == null || field.end == null) continue
    edits.push({
      start: field.start,
      end: field.end,
      text: format === 'xml' ? encodeXml(target.value) : target.value,
      key: target.key
    })
  }
  if (!edits.length) return null

  edits.sort((a, b) => b.start - a.start)
  let text = current
  for (const edit of edits) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  }

  // Verificación: la clave tocada tiene el valor pedido y ninguna otra se movió.
  const after = parseConfig(text, format)
  if (!after.ok) return null
  const wanted = new Map(targets.map((t) => [t.key, t.value]))
  for (const [key, field] of parsed.fields) {
    const now = after.fields.get(key)
    if (!now) return null
    const expected = wanted.has(key) ? wanted.get(key)! : field.value
    if (now.value !== expected) return null
  }
  if (after.fields.size !== parsed.fields.size) return null

  return { text, applied: edits.map((e) => e.key) }
}
