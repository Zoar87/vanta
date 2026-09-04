/**
 * Hilo de cálculo de hashes. Se lanzan varios en paralelo porque el cuello de
 * botella es el disco, no la CPU: mientras uno espera lectura, otro trabaja.
 */

import { parentPort } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export interface HashJob {
  abs: string
  rel: string
  root: number
  size: number
  mtimeMs: number
}

export interface HashDone extends HashJob {
  sha256: string
  error?: string
}

function hashFile(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(abs, { highWaterMark: 1024 * 1024 })
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

parentPort?.on('message', async (msg: { jobs: HashJob[] } | { stop: true }) => {
  if ('stop' in msg) {
    process.exit(0)
  }
  const results: HashDone[] = []
  for (const job of msg.jobs) {
    try {
      results.push({ ...job, sha256: await hashFile(job.abs) })
    } catch (err) {
      results.push({ ...job, sha256: '', error: (err as Error).message })
    }
  }
  parentPort?.postMessage({ results })
})
