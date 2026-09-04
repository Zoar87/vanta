/**
 * Cuarentena reversible.
 *
 * Nada se borra: los archivos se mueven a un almacén y queda un manifiesto con
 * la ruta exacta de la que salió cada uno, para poder devolverlos.
 *
 * El almacén está en la raíz de la misma unidad que el archivo. Así mover es
 * un renombrado instantáneo en lugar de copiar gigas entre discos. Un juego en
 * D: y su configuración en C: acaban en dos almacenes distintos, y el
 * manifiesto los une.
 */

import { rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Category, ChangeEntry, QuarantineBatch, QuarantineItem } from '../../shared/types'
import { longPath, moveFile, hideOnWindows, safeName as safe } from './fsx'

const STORE_DIR = '.vanta-cuarentena'

export function storeRootFor(target: string, fallback: string): string {
  const root = path.parse(path.resolve(target)).root
  return root && root !== path.sep ? path.join(root, STORE_DIR) : path.join(fallback, STORE_DIR)
}


export interface QuarantineInput {
  gameId: string
  gameName: string
  label: string
  category: Category
  roots: string[]
  entries: ChangeEntry[]
  /** Carpeta de datos de VANTA, por si la unidad no admite almacén propio. */
  fallbackDir: string
}

export async function quarantine(input: QuarantineInput): Promise<QuarantineBatch> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const items: QuarantineItem[] = []
  let storePath = ''

  for (const entry of input.entries) {
    // Lo desaparecido ya no está: no hay nada que mover.
    if (entry.status === 'desaparecido') continue
    const root = input.roots[entry.root]
    if (!root) continue
    const from = path.join(root, entry.rel.split('/').join(path.sep))
    if (!existsSync(longPath(from))) continue

    const store = storeRootFor(from, input.fallbackDir)
    if (!storePath) storePath = store
    const to = path.join(store, safe(input.gameId), id, String(entry.root), entry.rel.split('/').join(path.sep))

    try {
      const size = (await stat(longPath(from))).size
      await moveFile(from, to)
      items.push({ rel: entry.rel, root: entry.root, from, to, size, sha256: entry.sha256 })
      // El almacén ya existe tras el primer movimiento: ahora sí se puede ocultar.
      if (items.length === 1) hideOnWindows(store)
    } catch {
      // Archivo bloqueado o en uso: se salta y se informa por el recuento.
    }
  }

  return {
    id,
    gameId: input.gameId,
    gameName: input.gameName,
    createdAt: new Date().toISOString(),
    label: input.label,
    category: input.category,
    itemCount: items.length,
    totalBytes: items.reduce((n, i) => n + i.size, 0),
    storePath: storePath || input.fallbackDir,
    items
  }
}

export interface RestoreResult {
  restored: number
  skipped: { rel: string; reason: string }[]
}

export async function restore(batch: QuarantineBatch): Promise<RestoreResult> {
  const skipped: { rel: string; reason: string }[] = []
  let restored = 0

  for (const item of batch.items) {
    if (!existsSync(longPath(item.to))) {
      skipped.push({ rel: item.rel, reason: 'ya no está en la cuarentena' })
      continue
    }
    if (existsSync(longPath(item.from))) {
      skipped.push({ rel: item.rel, reason: 'ya existe un archivo en su sitio' })
      continue
    }
    try {
      await moveFile(item.to, item.from)
      restored++
    } catch (err) {
      skipped.push({ rel: item.rel, reason: (err as Error).message })
    }
  }
  return { restored, skipped }
}

/** Vaciado definitivo. Es la única función de todo VANTA que borra de verdad. */
export async function destroy(batch: QuarantineBatch): Promise<void> {
  const dirs = new Set(
    batch.items.map((i) => {
      const marker = `${path.sep}${batch.id}${path.sep}`
      const at = i.to.indexOf(marker)
      return at > 0 ? i.to.slice(0, at + marker.length - 1) : path.dirname(i.to)
    })
  )
  for (const dir of dirs) {
    await rm(longPath(dir), { recursive: true, force: true }).catch(() => {})
  }
}
