/**
 * Perfiles.
 *
 * Un perfil es un conjunto de archivos con nombre y color. Montarlo significa
 * ponerlos en la carpeta del juego; desmontarlo, apartarlos a un almacén.
 * Como es mover, no copiar, alternar entre montajes es instantáneo aunque el
 * perfil pese cien megas.
 *
 * El almacén vive en la misma unidad que el juego, por lo mismo que la
 * cuarentena: para que mover sea un renombrado y no una copia entre discos.
 */

import { rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { MountResult, Profile } from '../../shared/types'
import { longPath, moveFile, hideOnWindows, safeName as safe } from './fsx'

const STORE_DIR = '.vanta-perfiles'

export function storeRootFor(target: string, fallback: string): string {
  const root = path.parse(path.resolve(target)).root
  return root && root !== path.sep ? path.join(root, STORE_DIR) : path.join(fallback, STORE_DIR)
}

const slotFor = (profile: Profile, fallbackDir: string, roots: string[], item: { root: number; rel: string }): string =>
  path.join(
    storeRootFor(roots[item.root] ?? fallbackDir, fallbackDir),
    safe(profile.gameId),
    profile.id,
    String(item.root),
    item.rel.split('/').join(path.sep)
  )

const liveFor = (roots: string[], item: { root: number; rel: string }): string =>
  path.join(roots[item.root] ?? '', item.rel.split('/').join(path.sep))

/** Aparta los archivos del perfil a su almacén. El juego queda sin ellos. */
export async function unmount(
  profile: Profile,
  roots: string[],
  fallbackDir: string
): Promise<MountResult> {
  const result: MountResult = { moved: 0, bytes: 0, skipped: [] }
  const hidden = new Set<string>()
  for (const item of profile.items) {
    const from = liveFor(roots, item)
    const to = slotFor(profile, fallbackDir, roots, item)
    const store = storeRootFor(roots[item.root] ?? fallbackDir, fallbackDir)
    if (!existsSync(longPath(from))) {
      result.skipped.push({ rel: item.rel, reason: 'ya no está en el juego' })
      continue
    }
    try {
      const size = (await stat(longPath(from))).size
      await moveFile(from, to)
      result.moved++
      result.bytes += size
      // El almacén ya existe tras el primer movimiento: ahora sí se puede ocultar.
      if (!hidden.has(store)) {
        hidden.add(store)
        hideOnWindows(store)
      }
    } catch (err) {
      result.skipped.push({ rel: item.rel, reason: (err as Error).message })
    }
  }
  return result
}

/** Devuelve los archivos del perfil a la carpeta del juego. */
export async function mount(
  profile: Profile,
  roots: string[],
  fallbackDir: string
): Promise<MountResult> {
  const result: MountResult = { moved: 0, bytes: 0, skipped: [] }
  for (const item of profile.items) {
    const from = slotFor(profile, fallbackDir, roots, item)
    const to = liveFor(roots, item)
    if (!existsSync(longPath(from))) {
      result.skipped.push({ rel: item.rel, reason: 'no está en el almacén del perfil' })
      continue
    }
    // Choque: ya hay algo con ese nombre. Se avisa y no se pisa nada.
    if (existsSync(longPath(to))) {
      result.skipped.push({ rel: item.rel, reason: 'ya existe un archivo en su sitio' })
      continue
    }
    try {
      const size = (await stat(longPath(from))).size
      await moveFile(from, to)
      result.moved++
      result.bytes += size
    } catch (err) {
      result.skipped.push({ rel: item.rel, reason: (err as Error).message })
    }
  }
  return result
}

/** Comprueba qué archivos chocarían al montar, sin mover nada. */
export function collisions(profile: Profile, roots: string[]): string[] {
  return profile.items
    .filter((item) => existsSync(longPath(liveFor(roots, item))))
    .map((item) => item.rel)
}

/** Borra el almacén de un perfil. Solo se llama al eliminar el perfil vacío. */
export async function dropStore(
  profile: Profile,
  roots: string[],
  fallbackDir: string
): Promise<void> {
  const dirs = new Set(
    profile.items.map((item) =>
      path.join(
        storeRootFor(roots[item.root] ?? fallbackDir, fallbackDir),
        safe(profile.gameId),
        profile.id
      )
    )
  )
  for (const dir of dirs) await rm(longPath(dir), { recursive: true, force: true }).catch(() => {})
}

export const PROFILE_COLORS = [
  '#a855f7',
  '#22d3ee',
  '#f59e0b',
  '#3b82f6',
  '#2dd4bf',
  '#ec4899',
  '#84cc16',
  '#94a3b8'
]
