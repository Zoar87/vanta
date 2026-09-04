/**
 * Todo lo que VANTA guarda vive en %APPDATA%\VANTA, fuera de la carpeta del
 * programa, para que una actualización nunca pueda tocar tus datos.
 *
 *   library.json              la lista de juegos y sus fichas
 *   baselines/<id>.json.gz    la línea base de cada juego, comprimida
 */

import { app } from 'electron'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import path from 'node:path'
import type {
  Baseline, ChangeReport, Game, GameHistory, LearnedRule, Profile, QuarantineBatch
} from '../../shared/types'

const gz = promisify(gzip)
const gunz = promisify(gunzip)

export const dataDir = (): string => app.getPath('userData')
const libraryFile = (): string => path.join(dataDir(), 'library.json')
const baselineDir = (): string => path.join(dataDir(), 'baselines')
const safeId = (id: string): string => id.replace(/[^a-z0-9._-]/gi, '_')

async function ensureDirs(): Promise<void> {
  await mkdir(baselineDir(), { recursive: true })
}

/** Escritura atómica: primero a un temporal, luego se renombra. Nunca deja un archivo a medias. */
async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export async function loadLibrary(): Promise<Game[]> {
  await ensureDirs()
  try {
    const raw = await readFile(libraryFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.games) ? parsed.games : []
  } catch {
    return []
  }
}

export async function saveLibrary(games: Game[]): Promise<void> {
  await ensureDirs()
  await writeAtomic(libraryFile(), JSON.stringify({ version: 1, games }, null, 2))
}

export async function saveBaseline(baseline: Baseline): Promise<void> {
  await ensureDirs()
  const buf = await gz(Buffer.from(JSON.stringify(baseline)))
  await writeAtomic(path.join(baselineDir(), `${safeId(baseline.gameId)}.json.gz`), buf)
}

export async function loadBaseline(gameId: string): Promise<Baseline | null> {
  const file = path.join(baselineDir(), `${safeId(gameId)}.json.gz`)
  if (!existsSync(file)) return null
  try {
    const buf = await gunz(await readFile(file))
    return JSON.parse(buf.toString('utf8')) as Baseline
  } catch {
    return null
  }
}

export async function deleteBaseline(gameId: string): Promise<void> {
  const file = path.join(baselineDir(), `${safeId(gameId)}.json.gz`)
  if (existsSync(file)) await unlink(file).catch(() => {})
}

// ============================================================================
// Informes de cambios, cuarentena y reglas aprendidas
// ============================================================================

const reportFile = (gameId: string): string =>
  path.join(dataDir(), 'reports', `${safeId(gameId)}.json.gz`)
const quarantineIndex = (): string => path.join(dataDir(), 'quarantine.json')
const rulesFile = (): string => path.join(dataDir(), 'rules.json')

export async function saveReport(report: ChangeReport): Promise<void> {
  await mkdir(path.join(dataDir(), 'reports'), { recursive: true })
  await writeAtomic(reportFile(report.gameId), await gz(Buffer.from(JSON.stringify(report))))
}

export async function loadReport(gameId: string): Promise<ChangeReport | null> {
  const file = reportFile(gameId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse((await gunz(await readFile(file))).toString('utf8')) as ChangeReport
  } catch {
    return null
  }
}

export async function deleteReport(gameId: string): Promise<void> {
  if (existsSync(reportFile(gameId))) await unlink(reportFile(gameId)).catch(() => {})
}

export async function loadQuarantine(): Promise<QuarantineBatch[]> {
  try {
    const parsed = JSON.parse(await readFile(quarantineIndex(), 'utf8'))
    return Array.isArray(parsed.batches) ? parsed.batches : []
  } catch {
    return []
  }
}

export async function saveQuarantine(batches: QuarantineBatch[]): Promise<void> {
  await ensureDirs()
  await writeAtomic(quarantineIndex(), JSON.stringify({ version: 1, batches }, null, 2))
}

export async function loadRules(): Promise<LearnedRule[]> {
  try {
    const parsed = JSON.parse(await readFile(rulesFile(), 'utf8'))
    return Array.isArray(parsed.rules) ? parsed.rules : []
  } catch {
    return []
  }
}

export async function saveRules(rules: LearnedRule[]): Promise<void> {
  await ensureDirs()
  await writeAtomic(rulesFile(), JSON.stringify({ version: 1, rules }, null, 2))
}

// ============================================================================
// Perfiles e historial por juego
// ============================================================================

const profilesFile = (): string => path.join(dataDir(), 'profiles.json')
const historyFile = (gameId: string): string =>
  path.join(dataDir(), 'history', `${safeId(gameId)}.json`)

export async function loadProfiles(): Promise<Profile[]> {
  try {
    const parsed = JSON.parse(await readFile(profilesFile(), 'utf8'))
    return Array.isArray(parsed.profiles) ? parsed.profiles : []
  } catch {
    return []
  }
}

export async function saveProfiles(profiles: Profile[]): Promise<void> {
  await ensureDirs()
  await writeAtomic(profilesFile(), JSON.stringify({ version: 1, profiles }, null, 2))
}

export async function loadHistory(gameId: string): Promise<GameHistory> {
  try {
    const parsed = JSON.parse(await readFile(historyFile(gameId), 'utf8'))
    return {
      gameId,
      revisions: Array.isArray(parsed.revisions) ? parsed.revisions : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    }
  } catch {
    return { gameId, revisions: [], sessions: [] }
  }
}

export async function saveHistory(history: GameHistory): Promise<void> {
  await mkdir(path.join(dataDir(), 'history'), { recursive: true })
  // El historial no crece sin fin: se guardan las últimas entradas y basta.
  const trimmed: GameHistory = {
    ...history,
    revisions: history.revisions.slice(-60),
    sessions: history.sessions.slice(-60)
  }
  await writeAtomic(historyFile(history.gameId), JSON.stringify(trimmed, null, 2))
}
