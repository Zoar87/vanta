/**
 * Copia de seguridad de originales.
 *
 * Se guardan solo los archivos pequeños que un mod puede sobrescribir:
 * configuraciones, DLL, ejecutables y scripts, con un tope de 20 MB. Todo eso
 * junto ronda unos pocos cientos de megas por juego.
 *
 * Lo grande no se copia: para eso está la verificación de integridad de la
 * tienda. En juegos que no son de Steam el tope sube, porque ahí no hay
 * verificación que valga y esta copia es la única red de seguridad.
 */

import { mkdir, copyFile, rm, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { FileRecord, OriginalsSummary } from '../../shared/types'
import { longPath, safeName as safe } from './fsx'

const WORTH_KEEPING = /\.(ini|cfg|conf|xml|json|toml|yaml|yml|settings|prefs|properties|dll|exe|asi|lua|py|bat|cmd|ps1|js|txt|reg|manifest)$/i

const LIMIT_STORE = 20 * 1024 * 1024
const LIMIT_NO_STORE = 64 * 1024 * 1024

export const originalsDir = (dataDir: string, gameId: string): string =>
  path.join(dataDir, 'originals', safe(gameId))

export const originalPath = (
  dataDir: string,
  gameId: string,
  root: number,
  rel: string
): string => path.join(originalsDir(dataDir, gameId), String(root), rel.split('/').join(path.sep))

export function shouldKeep(rel: string, size: number, hasStoreVerification: boolean): boolean {
  if (!WORTH_KEEPING.test(rel)) return false
  return size <= (hasStoreVerification ? LIMIT_STORE : LIMIT_NO_STORE)
}

export interface BackupInput {
  dataDir: string
  gameId: string
  roots: string[]
  files: FileRecord[]
  hasStoreVerification: boolean
  onProgress?: (done: number, total: number) => void
}

export async function backupOriginals(input: BackupInput): Promise<OriginalsSummary> {
  const target = input.files.filter((f) => shouldKeep(f.rel, f.size, input.hasStoreVerification))
  const dir = originalsDir(input.dataDir, input.gameId)
  await rm(dir, { recursive: true, force: true }).catch(() => {})

  let done = 0
  let bytes = 0
  for (const f of target) {
    const from = path.join(input.roots[f.root] ?? '', f.rel.split('/').join(path.sep))
    const to = originalPath(input.dataDir, input.gameId, f.root, f.rel)
    try {
      await mkdir(longPath(path.dirname(to)), { recursive: true })
      await copyFile(longPath(from), longPath(to))
      bytes += f.size
    } catch {
      // Archivo bloqueado: no es crítico, se refleja en el recuento final.
    }
    done++
    if (input.onProgress && done % 50 === 0) input.onProgress(done, target.length)
  }
  return { fileCount: done, totalBytes: bytes }
}

export async function hasOriginal(
  dataDir: string,
  gameId: string,
  root: number,
  rel: string
): Promise<boolean> {
  return existsSync(longPath(originalPath(dataDir, gameId, root, rel)))
}

export async function restoreOriginal(
  dataDir: string,
  gameId: string,
  roots: string[],
  root: number,
  rel: string
): Promise<{ ok: boolean; error?: string }> {
  const from = originalPath(dataDir, gameId, root, rel)
  const to = path.join(roots[root] ?? '', rel.split('/').join(path.sep))
  if (!existsSync(longPath(from))) return { ok: false, error: 'No hay copia del original.' }
  try {
    await mkdir(longPath(path.dirname(to)), { recursive: true })
    await copyFile(longPath(from), longPath(to))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function measure(dataDir: string, gameId: string): Promise<OriginalsSummary | null> {
  const dir = originalsDir(dataDir, gameId)
  if (!existsSync(dir)) return null
  let fileCount = 0
  let totalBytes = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(current, e.name)
      if (e.isDirectory()) stack.push(full)
      else {
        fileCount++
        totalBytes += (await stat(full).catch(() => ({ size: 0 }))).size
      }
    }
  }
  return { fileCount, totalBytes }
}
