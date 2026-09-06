/**
 * Vigilante temporal.
 *
 * Para responder a «¿quién ha creado esto?». Se toma una foto ligera de la
 * carpeta, haces lo que sea que quieras observar (arrancar el juego, ejecutar
 * un instalador) y al volver se compara.
 *
 * A diferencia de la revisión normal, aquí no se calculan huellas: solo ruta,
 * tamaño y fecha. Es cuestión de milisegundos incluso en un juego de miles de
 * archivos, así que se puede empezar y parar a voluntad sin coste.
 *
 * Es deliberadamente manual y de usar y tirar: no queda ningún proceso
 * vigilando por detrás cuando no lo has pedido.
 */

import type { WatchChange, WatchResult } from '../../shared/types'
import { walk } from './scan'

export interface Watched {
  gameId: string
  startedAt: string
  roots: string[]
  files: Map<string, { size: number; mtimeMs: number }>
}

export type { WatchChange, WatchResult }

const key = (root: number, rel: string): string => `${root}|${rel}`

async function snapshot(roots: string[]): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const files = new Map<string, { size: number; mtimeMs: number }>()
  for (let i = 0; i < roots.length; i++) {
    for await (const f of walk(roots[i], i, () => false)) {
      files.set(key(i, f.rel), { size: f.size, mtimeMs: f.mtimeMs })
    }
  }
  return files
}

export async function startWatch(gameId: string, roots: string[]): Promise<Watched> {
  return {
    gameId,
    startedAt: new Date().toISOString(),
    roots,
    files: await snapshot(roots)
  }
}

export async function stopWatch(watch: Watched): Promise<WatchResult> {
  const ahora = await snapshot(watch.roots)
  const changes: WatchChange[] = []

  for (const [k, info] of ahora) {
    const antes = watch.files.get(k)
    const sep = k.indexOf('|')
    const root = Number(k.slice(0, sep))
    const rel = k.slice(sep + 1)
    if (!antes) {
      changes.push({ rel, root, kind: 'apareció', size: info.size, mtimeMs: info.mtimeMs })
    } else if (antes.size !== info.size || antes.mtimeMs !== info.mtimeMs) {
      changes.push({ rel, root, kind: 'cambió', size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  for (const [k, antes] of watch.files) {
    if (ahora.has(k)) continue
    const sep = k.indexOf('|')
    changes.push({
      rel: k.slice(sep + 1),
      root: Number(k.slice(0, sep)),
      kind: 'desapareció',
      size: antes.size,
      mtimeMs: antes.mtimeMs
    })
  }

  const endedAt = new Date().toISOString()
  changes.sort((a, b) => a.mtimeMs - b.mtimeMs || a.rel.localeCompare(b.rel))
  return {
    startedAt: watch.startedAt,
    endedAt,
    seconds: Math.round((Date.parse(endedAt) - Date.parse(watch.startedAt)) / 1000),
    changes
  }
}
