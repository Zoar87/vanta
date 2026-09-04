/**
 * Compara lo que hay ahora en el disco contra la línea base.
 *
 * Truco de rendimiento: si el tamaño y la fecha coinciden con la línea base,
 * el archivo se da por intacto y no se vuelve a leer. Solo se calcula el hash
 * de lo nuevo y de lo que ha cambiado, así que una revisión sobre un juego de
 * 100 GB tarda segundos en vez de minutos.
 *
 * La verificación profunda desactiva ese atajo y recalcula todo, para el caso
 * raro de un mod que sobrescribe conservando la fecha original.
 */

import path from 'node:path'
import { cpus } from 'node:os'
import type { Baseline, ChangeEntry, ScanProgress } from '../../shared/types'
import { walk, WorkerPool, type WalkedFile } from './scan'
import type { HashDone, HashJob } from './hashWorker'

export interface DiffOptions {
  gameId: string
  roots: string[]
  baseline: Baseline
  workerFile: string
  deep: boolean
  onProgress: (p: ScanProgress) => void
  isCancelled: () => boolean
}

export interface DiffResult {
  entries: ChangeEntry[]
  rehashed: number
  /** Archivos que no se pudieron leer (bloqueados o sin permisos). */
  unreadable: number
  durationMs: number
}

export async function diffAgainstBaseline(opts: DiffOptions): Promise<DiffResult | null> {
  const started = Date.now()
  const known = new Map<string, { size: number; mtimeMs: number; sha256: string }>()
  for (const f of opts.baseline.files) {
    known.set(`${f.root}|${f.rel}`, { size: f.size, mtimeMs: f.mtimeMs, sha256: f.sha256 })
  }

  const seen = new Set<string>()
  const entries: ChangeEntry[] = []
  const toHash: { job: HashJob; expected?: string }[] = []

  const progress: ScanProgress = {
    gameId: opts.gameId,
    phase: 'recorriendo',
    filesSeen: 0,
    filesHashed: 0,
    bytesHashed: 0,
    totalBytes: 0,
    currentPath: ''
  }
  let lastEmit = 0
  const emit = (force = false) => {
    const now = Date.now()
    if (force || now - lastEmit > 120) {
      lastEmit = now
      opts.onProgress({ ...progress })
    }
  }

  // --- recorrido ---
  for (let i = 0; i < opts.roots.length; i++) {
    for await (const file of walk(opts.roots[i], i, opts.isCancelled)) {
      progress.filesSeen++
      progress.currentPath = file.rel
      const key = `${i}|${file.rel}`
      seen.add(key)
      const base = known.get(key)

      if (!base) {
        toHash.push({ job: file })
        progress.totalBytes += file.size
      } else if (opts.deep || base.size !== file.size || base.mtimeMs !== file.mtimeMs) {
        toHash.push({ job: file, expected: base.sha256 })
        progress.totalBytes += file.size
      }
      if (progress.filesSeen % 500 === 0) emit()
    }
  }
  if (opts.isCancelled()) return null

  // --- solo se lee lo sospechoso ---
  progress.phase = 'calculando'
  emit(true)

  const pool = new WorkerPool(opts.workerFile, Math.max(2, Math.min(4, cpus().length)))
  let unreadable = 0
  try {
    const byPath = new Map<string, string | undefined>()
    for (const t of toHash) byPath.set(`${t.job.root}|${t.job.rel}`, t.expected)

    const CHUNK = 128
    const chunks: HashJob[][] = []
    for (let i = 0; i < toHash.length; i += CHUNK) {
      chunks.push(toHash.slice(i, i + CHUNK).map((t) => t.job))
    }

    const handle = (r: HashDone): void => {
      progress.filesHashed++
      progress.bytesHashed += r.size
      const key = `${r.root}|${r.rel}`
      const base = known.get(key)
      if (r.error) {
        // Un archivo nuevo que no se puede leer sigue siendo un archivo nuevo:
        // se registra sin huella. Un original ilegible se da por intacto.
        unreadable++
        if (!base) {
          entries.push({ rel: r.rel, root: r.root, status: 'nuevo', size: r.size, mtimeMs: r.mtimeMs, groupId: '', identity: 'no se pudo leer' })
        }
        return
      }
      if (!base) {
        entries.push({ rel: r.rel, root: r.root, status: 'nuevo', size: r.size, mtimeMs: r.mtimeMs, sha256: r.sha256, groupId: '' })
      } else if (r.sha256 !== byPath.get(key)) {
        entries.push({
          rel: r.rel,
          root: r.root,
          status: 'modificado',
          size: r.size,
          mtimeMs: r.mtimeMs,
          sha256: r.sha256,
          baselineSha256: base.sha256,
          baselineSize: base.size,
          groupId: ''
        })
      }
    }

    // Varios lotes en vuelo a la vez para que todos los hilos trabajen. Antes
    // se esperaba lote a lote y solo un hilo estaba ocupado en cada momento.
    let next = 0
    const runners = Array.from({ length: Math.min(8, chunks.length) }, async () => {
      while (next < chunks.length && !opts.isCancelled()) {
        const results = await pool.run(chunks[next++])
        for (const r of results) handle(r)
        emit()
      }
    })
    await Promise.all(runners)
    if (opts.isCancelled()) return null
  } finally {
    await pool.destroy()
  }

  // --- lo que estaba y ya no está ---
  for (const [key, base] of known) {
    if (seen.has(key)) continue
    const sep = key.indexOf('|')
    entries.push({
      rel: key.slice(sep + 1),
      root: Number(key.slice(0, sep)),
      status: 'desaparecido',
      size: 0,
      mtimeMs: 0,
      baselineSha256: base.sha256,
      baselineSize: base.size,
      groupId: ''
    })
  }

  // --- emparejado por huella ---
  //
  // Muchos parcheadores no borran nada: renombran el original a .BAK y ponen
  // el suyo. Visto desde fuera parece un archivo desaparecido y otro nuevo sin
  // relación. Pero si el hash del archivo nuevo es exactamente el del original,
  // no hay que suponer nada: es el mismo archivo con otro nombre.
  const baselineByHash = new Map<string, { root: number; rel: string }[]>()
  for (const f of opts.baseline.files) {
    const list = baselineByHash.get(f.sha256)
    if (list) list.push({ root: f.root, rel: f.rel })
    else baselineByHash.set(f.sha256, [{ root: f.root, rel: f.rel }])
  }

  const missing = new Map<string, ChangeEntry>()
  for (const e of entries) {
    if (e.status === 'desaparecido') missing.set(`${e.root}|${e.rel}`, e)
  }

  const newByHash = new Map<string, ChangeEntry>()
  for (const e of entries) {
    if (e.status !== 'nuevo' || !e.sha256) continue
    if (!newByHash.has(e.sha256)) newByHash.set(e.sha256, e)
    const candidates = baselineByHash.get(e.sha256)
    if (!candidates?.length) continue

    const renamed = candidates.find((c) => missing.has(`${c.root}|${c.rel}`))
    if (renamed) {
      e.pairedWith = { kind: 'renombrado-desde', root: renamed.root, rel: renamed.rel }
      const original = missing.get(`${renamed.root}|${renamed.rel}`)
      if (original) original.pairedWith = { kind: 'renombrado-a', root: e.root, rel: e.rel }
    } else {
      e.pairedWith = { kind: 'copia-de', root: candidates[0].root, rel: candidates[0].rel }
    }
  }

  // Un original sobrescrito se puede recuperar si su contenido antiguo sigue
  // por ahí con otro nombre, aunque no haya copia de seguridad en VANTA.
  for (const e of entries) {
    if (e.status !== 'modificado' || !e.baselineSha256) continue
    const twin = newByHash.get(e.baselineSha256)
    if (twin) e.recoverableFrom = twin.rel
  }

  entries.sort(
    (a, b) => a.root - b.root || a.status.localeCompare(b.status) || a.rel.localeCompare(b.rel)
  )

  return { entries, rehashed: progress.filesHashed, unreadable, durationMs: Date.now() - started }
}

export type { WalkedFile }
export const relToAbs = (roots: string[], root: number, rel: string): string =>
  path.join(roots[root] ?? '', rel.split('/').join(path.sep))
