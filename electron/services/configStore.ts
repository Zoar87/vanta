/**
 * Historial de versiones de los archivos de configuración.
 *
 * Pesan kilobytes, así que se guarda una copia cada vez que cambian. La
 * primera versión, la de fábrica, sale de la copia de originales que se hace
 * al fijar la línea base y nunca se borra.
 */

import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ConfigVersion } from '../../shared/types'
import { detectFormat } from './config'
import { originalPath } from './originals'

export interface ConfigFileHistory {
  root: number
  rel: string
  slug: string
  versions: ConfigVersion[]
}

const safe = (s: string): string => s.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80)
const dirFor = (dataDir: string, gameId: string): string =>
  path.join(dataDir, 'configs', safe(gameId))
const indexFile = (dataDir: string, gameId: string): string =>
  path.join(dirFor(dataDir, gameId), 'index.json')

export async function loadConfigIndex(
  dataDir: string,
  gameId: string
): Promise<ConfigFileHistory[]> {
  try {
    const parsed = JSON.parse(await readFile(indexFile(dataDir, gameId), 'utf8'))
    return Array.isArray(parsed.files) ? parsed.files : []
  } catch {
    return []
  }
}

async function saveConfigIndex(
  dataDir: string,
  gameId: string,
  files: ConfigFileHistory[]
): Promise<void> {
  await mkdir(dirFor(dataDir, gameId), { recursive: true })
  const file = indexFile(dataDir, gameId)
  await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, files }, null, 2))
  await rename(`${file}.tmp`, file)
}

const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

/**
 * Guarda una copia de los archivos de configuración que hayan cambiado.
 * Se llama después de cada revisión y no hace nada si el contenido se repite.
 */
export async function captureConfigs(
  dataDir: string,
  gameId: string,
  roots: string[],
  candidates: { root: number; rel: string; content?: string }[]
): Promise<number> {
  const index = await loadConfigIndex(dataDir, gameId)
  const dir = dirFor(dataDir, gameId)
  let saved = 0

  for (const candidate of candidates) {
    // El contenido puede venir dado (el registro de Windows no es un archivo).
    let content: Buffer
    if (candidate.content != null) {
      content = Buffer.from(candidate.content, 'utf8')
    } else {
      if (!detectFormat(candidate.rel)) continue
      const abs = path.join(roots[candidate.root] ?? '', candidate.rel.split('/').join(path.sep))
      if (!existsSync(abs)) continue
      try {
        content = await readFile(abs)
      } catch {
        continue
      }
    }
    if (content.length > 4 * 1024 * 1024) continue

    const slug = `${candidate.root}-${safe(candidate.rel)}`
    let entry = index.find((f) => f.root === candidate.root && f.rel === candidate.rel)
    if (!entry) {
      entry = { root: candidate.root, rel: candidate.rel, slug, versions: [] }
      index.push(entry)
    }

    await mkdir(path.join(dir, entry.slug), { recursive: true })

    // La versión de fábrica se toma una sola vez, de la copia de originales.
    if (candidate.content == null && !entry.versions.some((v) => v.factory)) {
      const factory = originalPath(dataDir, gameId, candidate.root, candidate.rel)
      if (existsSync(factory)) {
        const name = 'fabrica' + path.extname(candidate.rel)
        await copyFile(factory, path.join(dir, entry.slug, name))
        entry.versions.push({
          at: new Date(0).toISOString(),
          sha256: sha(await readFile(factory)),
          file: name,
          factory: true
        })
      }
    }

    const digest = sha(content)
    if (entry.versions.some((v) => v.sha256 === digest)) continue

    // El registro no tiene extensión propia: se archiva como .ini, que es el
    // formato en que se vuelca y compara.
    const ext = candidate.content != null ? '.ini' : path.extname(candidate.rel)
    const name = `${Date.now().toString(36)}${ext}`
    await writeFile(path.join(dir, entry.slug, name), content)
    entry.versions.push({ at: new Date().toISOString(), sha256: digest, file: name })
    // Se conservan la de fábrica y las quince últimas.
    const factory = entry.versions.filter((v) => v.factory)
    const rest = entry.versions.filter((v) => !v.factory).slice(-15)
    entry.versions = [...factory, ...rest]
    saved++
  }

  if (saved || index.length) await saveConfigIndex(dataDir, gameId, index)
  return saved
}

export async function readVersion(
  dataDir: string,
  gameId: string,
  slug: string,
  file: string
): Promise<string | null> {
  try {
    return await readFile(path.join(dirFor(dataDir, gameId), slug, file), 'utf8')
  } catch {
    return null
  }
}
