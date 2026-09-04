/**
 * Recorrido de carpetas y construcción de la línea base.
 *
 * El recorrido y el hashing van a la vez: en cuanto hay archivos suficientes se
 * despachan a los hilos, así el disco no se queda parado esperando al listado.
 */

import { readdir, lstat } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import type { Baseline, FileRecord, ScanProgress } from '../../shared/types'
import type { HashDone, HashJob } from './hashWorker'

import { longPath } from './fsx'

export { longPath }

/** Carpetas que nunca aportan nada y sí cuestan minutos de escaneo. */
const SKIP_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  '__installer',
  'directx',
  '_commonredist'
])

export interface WalkedFile extends HashJob {}

export interface ScanOptions {
  gameId: string
  roots: string[]
  workerFile: string
  onProgress: (p: ScanProgress) => void
  isCancelled: () => boolean
  /** Saltar carpetas de redistribuibles, que son idénticas en todos los juegos. */
  skipRedist?: boolean
}

export async function* walk(
  root: string,
  rootIndex: number,
  isCancelled: () => boolean,
  skipRedist = false
): AsyncGenerator<WalkedFile> {
  const pending: string[] = [root]
  while (pending.length) {
    if (isCancelled()) return
    const dir = pending.pop()!
    let entries
    try {
      entries = await readdir(longPath(dir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skipRedist && SKIP_DIRS.has(entry.name.toLowerCase())) continue
        pending.push(abs)
        continue
      }
      // Los enlaces simbólicos y las uniones no se siguen: podrían crear bucles
      // y su contenido pertenece a otro sitio.
      if (entry.isSymbolicLink()) continue
      if (!entry.isFile()) continue
      try {
        const st = await lstat(longPath(abs))
        yield {
          abs,
          rel: path.relative(root, abs).split(path.sep).join('/'),
          root: rootIndex,
          size: st.size,
          mtimeMs: Math.round(st.mtimeMs)
        }
      } catch {
        /* archivo desaparecido o bloqueado */
      }
    }
  }
}

/**
 * Reparto de trabajo entre varios hilos de hashing.
 *
 * Cada hilo procesa un lote y devuelve los resultados. Si un hilo muere a
 * mitad de un lote (por ejemplo, por un archivo que bloquea el sistema), el
 * lote se da por perdido con sus archivos marcados como error, se levanta un
 * hilo nuevo y la cola sigue. Antes de esto, un hilo caído dejaba el escaneo
 * esperando para siempre.
 */
export class WorkerPool {
  private workers = new Set<Worker>()
  private idle: Worker[] = []
  private queue: { jobs: HashJob[]; resolve: (r: HashDone[]) => void }[] = []
  private busy = new Map<Worker, { jobs: HashJob[]; resolve: (r: HashDone[]) => void }>()
  private destroyed = false

  constructor(
    private readonly file: string,
    size: number
  ) {
    for (let i = 0; i < size; i++) this.spawn()
  }

  private spawn(): void {
    const w = new Worker(this.file)
    const fail = () => {
      if (!this.workers.has(w)) return
      const task = this.busy.get(w)
      this.busy.delete(w)
      this.workers.delete(w)
      this.idle = this.idle.filter((x) => x !== w)
      if (task) {
        task.resolve(task.jobs.map((j) => ({ ...j, sha256: '', error: 'el hilo de hashing falló' })))
      }
      if (!this.destroyed) {
        this.spawn()
        this.pump()
      }
    }
    w.on('error', fail)
    w.on('exit', (code) => {
      if (code !== 0 && !this.destroyed) fail()
    })
    this.workers.add(w)
    this.idle.push(w)
  }

  run(jobs: HashJob[]): Promise<HashDone[]> {
    return new Promise((resolve) => {
      this.queue.push({ jobs, resolve })
      this.pump()
    })
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!
      const task = this.queue.shift()!
      this.busy.set(worker, task)
      const onMessage = (msg: { results: HashDone[] }) => {
        worker.off('message', onMessage)
        this.busy.delete(worker)
        this.idle.push(worker)
        task.resolve(msg.results)
        this.pump()
      }
      worker.on('message', onMessage)
      worker.postMessage({ jobs: task.jobs })
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    await Promise.all([...this.workers].map((w) => w.terminate()))
    this.workers.clear()
    this.idle = []
    this.busy.clear()
  }
}

export async function buildBaseline(opts: ScanOptions): Promise<Baseline | null> {
  const started = Date.now()
  const progress: ScanProgress = {
    gameId: opts.gameId,
    phase: 'recorriendo',
    filesSeen: 0,
    filesHashed: 0,
    bytesHashed: 0,
    totalBytes: 0,
    currentPath: ''
  }
  const emit = () => opts.onProgress({ ...progress })

  // Un hilo por núcleo hasta cuatro: más allá el disco no da para más.
  const pool = new WorkerPool(opts.workerFile, Math.max(2, Math.min(4, cpus().length)))
  const files: FileRecord[] = []
  let unreadable = 0
  const rootStats = opts.roots.map((p) => ({ path: p, fileCount: 0, totalBytes: 0 }))
  const inFlight: Promise<void>[] = []
  let batch: WalkedFile[] = []
  let lastEmit = 0

  const flush = (force = false) => {
    if (!batch.length) return
    if (!force && batch.length < 64) return
    const jobs = batch
    batch = []
    inFlight.push(
      pool.run(jobs).then((results) => {
        for (const r of results) {
          progress.filesHashed++
          progress.bytesHashed += r.size
          if (r.error) {
            unreadable++
            continue
          }
          rootStats[r.root].fileCount++
          rootStats[r.root].totalBytes += r.size
          files.push({ rel: r.rel, root: r.root, size: r.size, mtimeMs: r.mtimeMs, sha256: r.sha256 })
        }
        progress.phase = 'calculando'
        const now = Date.now()
        if (now - lastEmit > 120) {
          lastEmit = now
          emit()
        }
      })
    )
  }

  try {
    for (let i = 0; i < opts.roots.length; i++) {
      for await (const file of walk(opts.roots[i], i, opts.isCancelled, opts.skipRedist)) {
        progress.filesSeen++
        progress.totalBytes += file.size
        progress.currentPath = file.rel
        batch.push(file)
        flush()
        if (progress.filesSeen % 500 === 0) emit()
        // No dejar que la cola crezca sin límite en juegos enormes.
        if (inFlight.length > 64) {
          await Promise.all(inFlight.splice(0, inFlight.length))
        }
      }
    }
    flush(true)
    await Promise.all(inFlight)

    if (opts.isCancelled()) {
      progress.phase = 'cancelado'
      emit()
      return null
    }

    progress.phase = 'guardando'
    emit()

    files.sort((a, b) => a.root - b.root || a.rel.localeCompare(b.rel))

    return {
      gameId: opts.gameId,
      summary: {
        takenAt: new Date().toISOString(),
        fileCount: files.length,
        totalBytes: files.reduce((n, f) => n + f.size, 0),
        durationMs: Date.now() - started,
        unreadable,
        roots: rootStats
      },
      files
    }
  } finally {
    await pool.destroy()
  }
}
