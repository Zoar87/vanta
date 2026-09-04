/**
 * Proceso principal de VANTA.
 *
 * Aquí vive todo lo que toca el disco, el registro o el sistema: la interfaz
 * solo puede hacer lo que este archivo expone por IPC. Está ordenado por
 * secciones, en el mismo orden en que se usan:
 *
 *   1. Arranque y ventana
 *   2. Biblioteca de juegos y carátulas
 *   3. Línea base y ficha técnica
 *   4. Revisión de cambios y grupos
 *   5. Purga y cuarentena
 *   6. Perfiles y lanzador
 *   7. Configuraciones (archivos y registro)
 *   8. Historial, informes y ajustes
 *
 * Regla que se cumple en todas: ninguna operación destructiva sin pasar por
 * cuarentena, y todo lo que mueve archivos invalida la última revisión.
 */

import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import {
  rename as renameFile,
  mkdir,
  copyFile,
  readFile,
  readdir,
  stat as statFile,
  writeFile
} from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'

import type {
  Category,
  ChangeEntry,
  ChangeReport,
  Game,
  LearnedRule,
  Profile,
  QuarantineBatch,
  RevisionSummary,
  ScanProgress
} from '../shared/types'
import { longPath, absOf } from './services/fsx'
import { detectGames, currentBuildId } from './services/detect'
import { buildBaseline } from './services/scan'
import { buildSpec } from './services/spec'
import { suggestLinkedPaths } from './services/links'
import {
  loadLibrary,
  saveLibrary,
  saveBaseline,
  loadBaseline,
  deleteBaseline,
  dataDir,
  saveReport,
  loadReport,
  deleteReport,
  loadQuarantine,
  saveQuarantine,
  loadRules,
  saveRules,
  loadProfiles,
  saveProfiles,
  loadHistory,
  saveHistory
} from './services/store'
import { diffAgainstBaseline } from './services/diff'
import { classify, deriveRules, CATEGORY_LABEL } from './services/classify'
import { quarantine, restore as restoreBatch, destroy as destroyBatch } from './services/quarantine'
import {
  backupOriginals,
  restoreOriginal,
  hasOriginal,
  measure as measureOriginals
} from './services/originals'
import { resolveArt, artDir } from './services/art'
import { mount, unmount, collisions, dropStore, PROFILE_COLORS } from './services/profiles'
import { readDeployments } from './services/vortex'
import { buildMarkdown, findConflicts } from './services/report'
import { diffConfig, detectFormat, revertKeys } from './services/config'
import { captureConfigs, loadConfigIndex, readVersion } from './services/configStore'
import {
  dumpRegistry,
  isRegistryConfig,
  registryKeyOf,
  unityRegistryKey,
  REGISTRY_PREFIX
} from './services/registry'
import { checkForUpdates, installUpdate, currentUpdateState, onUpdateState } from './services/updater'

// =============================================================================
// 1. Arranque y ventana
// =============================================================================

app.setName('VANTA')

// Las carátulas se sirven por un esquema propio (vanta://art/...) en vez de
// incrustarlas en base64: así Chromium las cachea y no viajan megas por IPC.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vanta', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

const isDev = !app.isPackaged && process.env.VANTA_DEV === '1'
const WORKER = () => path.join(__dirname, 'hashWorker.js')

let win: BrowserWindow | null = null

/** Estado en memoria. Cada cambio se guarda en disco antes de devolverlo. */
let library: Game[] = []
let batches: QuarantineBatch[] = []
let rules: LearnedRule[] = []
let profiles: Profile[] = []

/** Un escaneo en curso por juego se puede cancelar desde la interfaz. */
const cancelFlags = new Map<string, boolean>()

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 640,
    backgroundColor: '#0d1017',
    title: 'VANTA',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (isDev) win.loadURL('http://localhost:5183')
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.on('closed', () => {
    win = null
  })
}

/** Manda un evento a la ventana si sigue viva. */
const emit = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** Guarda la biblioteca y avisa a la interfaz de que ha cambiado. */
async function persist(): Promise<void> {
  await saveLibrary(library)
  emit('library:changed', library)
}

const gameById = (id: string): Game | undefined => library.find((g) => g.id === id)

/** Rutas absolutas de las raíces tal y como quedaron en la línea base. */
const rootsOf = (game: Game): string[] => game.baseline?.roots.map((r) => r.path) ?? [game.path]

/** Índices de raíz que el usuario marcó como protegidas (partidas, etc.). */
const protectedRootsOf = (game: Game): Set<number> => {
  const locked = new Set(game.linkedPaths.filter((l) => l.protected).map((l) => l.path.toLowerCase()))
  const out = new Set<number>()
  rootsOf(game).forEach((r, i) => {
    if (locked.has(r.toLowerCase())) out.add(i)
  })
  return out
}

/** Progreso mínimo para las fases que no tienen recuento propio. */
const progressStub = (gameId: string, phase: ScanProgress['phase'], message?: string): ScanProgress => ({
  gameId,
  phase,
  filesSeen: 0,
  filesHashed: 0,
  bytesHashed: 0,
  totalBytes: 0,
  currentPath: '',
  message
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  dataDir: dataDir()
}))

// =============================================================================
// 2. Biblioteca de juegos y carátulas
// =============================================================================

/** Busca la carátula de los juegos que aún no la tengan. Idempotente y barato. */
async function ensureArt(games: Game[]): Promise<boolean> {
  let changed = false
  for (const game of games) {
    if (game.art) continue
    const art = await resolveArt(game, dataDir())
    game.art = art ?? { source: 'ninguna', resolvedAt: new Date().toISOString() }
    changed = true
  }
  return changed
}

ipcMain.handle('library:list', async () => {
  if (!library.length) library = await loadLibrary()
  if (await ensureArt(library)) await persist()
  return library
})

ipcMain.handle('games:detect', async () => {
  const result = await detectGames()
  const known = new Set(library.map((g) => g.path.toLowerCase()))
  return {
    notes: result.notes,
    games: result.games.map((g) => ({ ...g, alreadyAdded: known.has(g.path.toLowerCase()) }))
  }
})

ipcMain.handle('library:add', async (_e, incoming: Partial<Game>[]) => {
  for (const g of incoming) {
    if (!g.path || library.some((x) => x.path.toLowerCase() === g.path!.toLowerCase())) continue
    library.push({
      id: g.id ?? `manual:${Buffer.from(g.path).toString('base64url').slice(0, 16)}`,
      name: g.name ?? path.basename(g.path),
      path: g.path,
      platform: g.platform ?? 'manual',
      appId: g.appId,
      buildId: g.buildId,
      addedAt: new Date().toISOString(),
      linkedPaths: []
    })
  }
  library.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  await persist()
  return library
})

ipcMain.handle('library:addFolder', async () => {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title: 'Elige la carpeta raíz del juego',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return { path: res.filePaths[0], name: path.basename(res.filePaths[0]) }
})

/** Solo se pueden cambiar desde fuera los campos que el usuario edita. */
ipcMain.handle('library:update', async (_e, id: string, patch: Partial<Game>) => {
  const game = gameById(id)
  if (!game) return null
  if (patch.name !== undefined) game.name = patch.name
  if (patch.color !== undefined) game.color = patch.color
  if (patch.linkedPaths !== undefined) game.linkedPaths = patch.linkedPaths
  await persist()
  return game
})

/** Qué se quedaría colgando si quitas este juego. */
ipcMain.handle('library:removePreview', async (_e, id: string) => {
  const mine = profiles.filter((p) => p.gameId === id)
  const lots = batches.filter((b) => b.gameId === id && !b.restored)
  return {
    profiles: mine.length,
    unmounted: mine.filter((p) => !p.mounted).length,
    unmountedFiles: mine.filter((p) => !p.mounted).reduce((n, p) => n + p.fileCount, 0),
    batches: lots.length,
    batchFiles: lots.reduce((n, b) => n + b.itemCount, 0)
  }
})

ipcMain.handle('library:remove', async (_e, id: string, options?: { restoreQuarantine?: boolean }) => {
  const game = gameById(id)
  const returned = { profiles: 0, quarantine: 0 }

  // Antes de soltar el juego se devuelve todo lo suyo. VANTA no se queda con
  // archivos tuyos en almacenes que ya nadie va a mirar.
  if (game) {
    const roots = rootsOf(game)
    for (const profile of profiles.filter((p) => p.gameId === id)) {
      if (!profile.mounted) returned.profiles += (await mount(profile, roots, dataDir())).moved
      await dropStore(profile, roots, dataDir())
    }
    if (options?.restoreQuarantine) {
      for (const batch of batches.filter((b) => b.gameId === id && !b.restored)) {
        returned.quarantine += (await restoreBatch(batch)).restored
        batch.restored = new Date().toISOString()
      }
      await saveQuarantine(batches)
    }
  }

  profiles = profiles.filter((p) => p.gameId !== id)
  await saveProfiles(profiles)
  library = library.filter((g) => g.id !== id)
  await deleteBaseline(id)
  await deleteReport(id)
  await persist()
  return { games: library, returned }
})

ipcMain.handle('art:refresh', async (_e, id: string) => {
  const game = gameById(id)
  if (!game) return null
  game.art = (await resolveArt(game, dataDir())) ?? { source: 'ninguna', resolvedAt: new Date().toISOString() }
  await persist()
  return game.art
})

ipcMain.handle('game:suggestLinks', async (_e, id: string) => {
  const game = gameById(id)
  if (!game) return []
  const found = await suggestLinkedPaths(game.name)
  const already = new Set(game.linkedPaths.map((l) => l.path.toLowerCase()))
  return found.filter((f) => !already.has(f.path.toLowerCase()))
})

ipcMain.handle('game:buildId', async (_e, id: string) => {
  const game = gameById(id)
  return game ? await currentBuildId(game) : undefined
})

/** Abre la verificación de integridad de Steam para este juego. */
ipcMain.handle('steam:validate', async (_e, id: string) => {
  const game = gameById(id)
  if (game?.platform !== 'steam' || !game.appId) return { ok: false, error: 'Este juego no es de Steam.' }
  await shell.openExternal(`steam://validate/${game.appId}`)
  return { ok: true }
})

ipcMain.handle('shell:reveal', async (_e, target: string) => {
  if (existsSync(target)) await shell.openPath(target)
})

// =============================================================================
// 3. Línea base y ficha técnica
// =============================================================================

ipcMain.handle('scan:cancel', (_e, id: string) => {
  cancelFlags.set(id, true)
})

/**
 * Qué pasaría si se rehace la línea base ahora. Si hay perfiles montados, sus
 * archivos pasarían a contar como originales del juego, que casi nunca es lo
 * que se quiere. La interfaz pregunta antes de seguir.
 */
ipcMain.handle('scan:baselinePreview', async (_e, id: string) => {
  const mine = profiles.filter((p) => p.gameId === id)
  return {
    mounted: mine.filter((p) => p.mounted).map((p) => ({ id: p.id, name: p.name })),
    unmounted: mine.filter((p) => !p.mounted).map((p) => ({ id: p.id, name: p.name }))
  }
})

/** Ficha técnica a partir de la lista de archivos: motor, API, anticheat... */
async function analyze(game: Game, relPaths: string[]) {
  const spec = await buildSpec({ gameName: game.name, gamePath: game.path, relPaths })
  game.spec = spec
  // Unity guarda sus ajustes en el registro. Con los datos de versión del
  // ejecutable ya se sabe en qué clave mirar.
  game.registryKey = unityRegistryKey(spec.mainExecutablePe) ?? undefined
  // Con el ejecutable identificado se puede sacar su icono incrustado.
  if (!game.art?.cover && !game.art?.icon) {
    game.art = (await resolveArt(game, dataDir())) ?? game.art
  }
  return spec
}

/** Rehace la ficha técnica sin volver a leer todo el juego. */
ipcMain.handle('game:reanalyze', async (_e, id: string) => {
  const game = gameById(id)
  if (!game) return { ok: false, error: 'Juego no encontrado.' }
  const baseline = await loadBaseline(id)
  if (!baseline) return { ok: false, error: 'Fija primero la línea base.' }
  const spec = await analyze(
    game,
    baseline.files.filter((f) => f.root === 0).map((f) => f.rel)
  )
  await persist()
  return { ok: true, spec }
})

ipcMain.handle('scan:start', async (_e, id: string) => {
  const game = gameById(id)
  if (!game) return { ok: false, error: 'Juego no encontrado en la biblioteca.' }
  if (!existsSync(game.path)) {
    return { ok: false, error: 'La carpeta del juego ya no existe. ¿La has movido o desinstalado?' }
  }

  cancelFlags.set(id, false)
  const roots = [game.path, ...game.linkedPaths.map((l) => l.path)].filter((p) => existsSync(p))

  try {
    const baseline = await buildBaseline({
      gameId: id,
      roots,
      workerFile: WORKER(),
      isCancelled: () => cancelFlags.get(id) === true,
      onProgress: (p) => emit('scan:progress', p)
    })
    if (!baseline) {
      emit('scan:progress', progressStub(id, 'cancelado'))
      return { ok: false, error: 'Escaneo cancelado.' }
    }

    const full = (phase: ScanProgress['phase'], message?: string): ScanProgress => ({
      gameId: id,
      phase,
      filesSeen: baseline.summary.fileCount,
      filesHashed: baseline.summary.fileCount,
      bytesHashed: baseline.summary.totalBytes,
      totalBytes: baseline.summary.totalBytes,
      currentPath: '',
      message
    })

    emit('scan:progress', full('analizando', 'Leyendo cabeceras de los ejecutables'))
    const spec = await analyze(
      game,
      baseline.files.filter((f) => f.root === 0).map((f) => f.rel)
    )

    baseline.summary.buildId = await currentBuildId(game)
    await saveBaseline(baseline)

    emit('scan:progress', full('guardando', 'Guardando copia de los originales pequeños'))
    const originals = await backupOriginals({
      dataDir: dataDir(),
      gameId: id,
      roots,
      files: baseline.files,
      hasStoreVerification: game.platform === 'steam' || game.platform === 'epic'
    })

    // Una línea base nueva invalida la comparación anterior.
    await deleteReport(id)

    game.baseline = baseline.summary
    game.buildId = baseline.summary.buildId ?? game.buildId
    await persist()

    emit('scan:progress', full('hecho'))
    return { ok: true, summary: baseline.summary, spec, originals }
  } catch (err) {
    const message = (err as Error).message
    emit('scan:progress', progressStub(id, 'error', message))
    return { ok: false, error: message }
  } finally {
    cancelFlags.delete(id)
  }
})

ipcMain.handle('baseline:peek', async (_e, id: string, limit: number) => {
  const baseline = await loadBaseline(id)
  if (!baseline) return null
  return { summary: baseline.summary, sample: baseline.files.slice(0, limit ?? 200) }
})

ipcMain.handle('originals:measure', async (_e, id: string) => measureOriginals(dataDir(), id))

// =============================================================================
// 4. Revisión de cambios y grupos
// =============================================================================

ipcMain.handle('changes:load', async (_e, id: string) => loadReport(id))

ipcMain.handle('changes:scan', async (_e, id: string, deep: boolean) => {
  const game = gameById(id)
  if (!game) return { ok: false, error: 'Juego no encontrado.' }
  const baseline = await loadBaseline(id)
  if (!baseline) return { ok: false, error: 'Este juego no tiene línea base todavía.' }

  cancelFlags.set(id, false)
  try {
    const roots = rootsOf(game)

    // --- 1. Qué ha cambiado respecto a la línea base ---
    const diff = await diffAgainstBaseline({
      gameId: id,
      roots,
      baseline,
      deep: !!deep,
      workerFile: WORKER(),
      isCancelled: () => cancelFlags.get(id) === true,
      onProgress: (p) => emit('scan:progress', p)
    })
    if (!diff) return { ok: false, error: 'Revisión cancelada.' }

    emit('scan:progress', {
      ...progressStub(id, 'analizando', 'Identificando lo que ha aparecido'),
      filesSeen: diff.entries.length,
      filesHashed: diff.rehashed
    })

    // --- 2. Qué es cada cosa ---
    const deployment = await readDeployments(roots)
    const { entries, groups } = await classify({
      entries: diff.entries,
      roots,
      protectedRoots: protectedRootsOf(game),
      learned: rules,
      deployed: deployment.files,
      gameId: id,
      batchLabel: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    })

    // Un original sobrescrito es recuperable si hay copia en VANTA o si el
    // propio parcheador dejó el original con otro nombre (emparejado por huella).
    for (const entry of entries) {
      if (entry.status === 'modificado') {
        entry.hasOriginal =
          (await hasOriginal(dataDir(), id, entry.root, entry.rel)) || !!entry.recoverableFrom
      }
    }

    // --- 3. Guardar el informe y anotarlo en el historial ---
    const current = await currentBuildId(game)
    const report: ChangeReport = {
      gameId: id,
      takenAt: new Date().toISOString(),
      durationMs: diff.durationMs,
      baselineTakenAt: baseline.summary.takenAt,
      buildIdChanged:
        current && baseline.summary.buildId && current !== baseline.summary.buildId
          ? { from: baseline.summary.buildId, to: current }
          : undefined,
      rehashed: diff.rehashed,
      unreadable: diff.unreadable,
      deep: !!deep,
      entries,
      groups
    }
    await saveReport(report)

    const history = await loadHistory(id)
    const revision: RevisionSummary = {
      takenAt: report.takenAt,
      deep: report.deep,
      durationMs: report.durationMs,
      rehashed: report.rehashed,
      totals: {
        nuevo: entries.filter((e) => e.status === 'nuevo').length,
        modificado: entries.filter((e) => e.status === 'modificado').length,
        desaparecido: entries.filter((e) => e.status === 'desaparecido').length
      },
      groups: groups.map((g) => ({
        name: g.name,
        category: g.category,
        fileCount: g.fileCount,
        totalBytes: g.totalBytes
      }))
    }
    history.revisions.push(revision)
    await saveHistory(history)

    // --- 4. Archivar las configuraciones tocadas (y el registro de Unity) ---
    const configCandidates: { root: number; rel: string; content?: string }[] = entries
      .filter((e) => e.status !== 'desaparecido' && detectFormat(e.rel))
      .map((e) => ({ root: e.root, rel: e.rel }))
    if (game.registryKey) {
      const dump = await dumpRegistry(game.registryKey)
      if (dump) configCandidates.push({ root: 0, rel: `${REGISTRY_PREFIX}${game.registryKey}`, content: dump })
    }
    await captureConfigs(dataDir(), id, roots, configCandidates)

    emit('scan:progress', {
      ...progressStub(
        id,
        'hecho',
        entries.length
          ? `${entries.length.toLocaleString('es-ES')} cambios encontrados`
          : 'Sin cambios respecto a la línea base'
      ),
      filesSeen: diff.rehashed,
      filesHashed: diff.rehashed
    })
    return { ok: true, report }
  } catch (err) {
    const message = (err as Error).message
    emit('scan:progress', progressStub(id, 'error', message))
    return { ok: false, error: message }
  } finally {
    cancelFlags.delete(id)
  }
})

/** El usuario pone nombre y categoría a un grupo; opcionalmente lo aprende. */
ipcMain.handle(
  'group:name',
  async (_e, id: string, groupId: string, name: string, category: Category, remember: boolean) => {
    const report = await loadReport(id)
    if (!report) return { ok: false, error: 'No hay revisión guardada.' }
    const group = report.groups.find((g) => g.id === groupId)
    if (!group) return { ok: false, error: 'Ese grupo ya no existe.' }

    group.name = name
    group.category = category
    group.kind = 'manual'
    group.detectedBy = 'lo nombraste tú'

    if (remember) {
      const members = report.entries.filter((e) => e.groupId === groupId)
      rules = [...rules, ...deriveRules(members, report.entries, name, category, id)]
      await saveRules(rules)
    }
    await saveReport(report)
    return { ok: true, report }
  }
)

ipcMain.handle('rules:list', async () => rules)

ipcMain.handle('rules:remove', async (_e, ruleId: string) => {
  rules = rules.filter((r) => r.id !== ruleId)
  await saveRules(rules)
  return rules
})

/** Deshace los renombrados de un parcheador: devuelve cada .BAK a su nombre real. */
ipcMain.handle('rename:undo', async (_e, id: string, groupId: string) => {
  const game = gameById(id)
  const report = await loadReport(id)
  if (!game || !report) return { ok: false, error: 'Falta el juego o su revisión.' }
  const roots = rootsOf(game)
  const pairs = report.entries.filter(
    (e) => e.groupId === groupId && e.pairedWith?.kind === 'renombrado-desde'
  )

  let done = 0
  const failed: string[] = []
  for (const entry of pairs) {
    const target = entry.pairedWith!
    const from = absOf(roots, entry.root, entry.rel)
    const to = absOf(roots, target.root, target.rel)
    if (existsSync(longPath(to))) {
      failed.push(`${target.rel} (ya existe algo en su sitio)`)
      continue
    }
    try {
      await mkdir(longPath(path.dirname(to)), { recursive: true })
      await renameFile(longPath(from), longPath(to))
      done++
    } catch (err) {
      failed.push(`${entry.rel}: ${(err as Error).message}`)
    }
  }

  // El informe queda obsoleto en cuanto se mueven archivos.
  await deleteReport(id)
  return { ok: true, done, failed }
})

// =============================================================================
// 5. Purga y cuarentena
// =============================================================================

/**
 * Devuelve un original sobrescrito a su estado de fábrica.
 *
 * Primero desde la copia que guarda VANTA. Si no la hay, desde el archivo del
 * propio juego que el emparejado por huella identificó como el original con
 * otro nombre (por ejemplo, el .BAK que deja un parcheador).
 */
async function restoreEntryOriginal(
  game: Game,
  report: ChangeReport | null,
  root: number,
  rel: string
): Promise<{ ok: boolean; error?: string; source?: string }> {
  const roots = rootsOf(game)
  const fromStore = await restoreOriginal(dataDir(), game.id, roots, root, rel)
  if (fromStore.ok) return { ...fromStore, source: 'copia de VANTA' }

  const entry = report?.entries.find((e) => e.root === root && e.rel === rel)
  if (!entry?.recoverableFrom) return fromStore
  try {
    await copyFile(longPath(absOf(roots, root, entry.recoverableFrom)), longPath(absOf(roots, root, rel)))
    return { ok: true, source: entry.recoverableFrom }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

ipcMain.handle('original:restore', async (_e, id: string, root: number, rel: string) => {
  const game = gameById(id)
  if (!game) return { ok: false, error: 'Juego no encontrado.' }
  return restoreEntryOriginal(game, await loadReport(id), root, rel)
})

/** Qué haría una purga, antes de tocar nada. */
function planPurge(report: ChangeReport, groupId: string | null) {
  const groups = report.groups.filter((g) => (groupId ? g.id === groupId : true))
  const usable = groups.filter((g) => !g.locked)
  const blocked = groups.filter((g) => g.locked)
  const ids = new Set(usable.map((g) => g.id))
  const members = report.entries.filter((e) => ids.has(e.groupId))
  return {
    usable,
    blocked,
    toQuarantine: members.filter((e) => e.status === 'nuevo'),
    toRestore: members.filter((e) => e.status === 'modificado' && e.hasOriginal),
    stuck: members.filter((e) => e.status === 'modificado' && !e.hasOriginal)
  }
}

ipcMain.handle('purge:preview', async (_e, id: string, groupId: string | null) => {
  const report = await loadReport(id)
  if (!report) return null
  const plan = planPurge(report, groupId)
  return {
    quarantine: plan.toQuarantine.length,
    quarantineBytes: plan.toQuarantine.reduce((n, e) => n + e.size, 0),
    restore: plan.toRestore.length,
    stuck: plan.stuck.length,
    blockedGroups: plan.blocked.map((g) => g.name),
    groups: plan.usable.map((g) => ({ name: g.name, category: CATEGORY_LABEL[g.category] }))
  }
})

ipcMain.handle('purge:run', async (_e, id: string, groupId: string | null) => {
  const game = gameById(id)
  const report = await loadReport(id)
  if (!game || !report) return { ok: false, error: 'Falta el juego o su revisión.' }

  const roots = rootsOf(game)
  const plan = planPurge(report, groupId)
  const label = groupId ? (report.groups.find((g) => g.id === groupId)?.name ?? 'grupo') : 'Purga total'

  // Primero se restauran los originales y después se mueve lo añadido. El
  // orden importa: un .BAK puede ser a la vez "archivo añadido" y la única
  // copia del original, y si se apartara antes ya no habría de dónde restaurar.
  let restored = 0
  const failed: string[] = []
  for (const entry of plan.toRestore) {
    const res = await restoreEntryOriginal(game, report, entry.root, entry.rel)
    if (res.ok) restored++
    else failed.push(entry.rel)
  }

  let batch: QuarantineBatch | null = null
  if (plan.toQuarantine.length) {
    batch = await quarantine({
      gameId: id,
      gameName: game.name,
      label,
      category: plan.usable[0]?.category ?? 'desconocido',
      roots,
      entries: plan.toQuarantine,
      fallbackDir: dataDir()
    })
    batches = [batch, ...batches]
    await saveQuarantine(batches)
  }

  // Lo tratado sale del informe; lo que no se pudo tocar se queda a la vista.
  const handled = new Set<ChangeEntry>([...plan.toQuarantine, ...plan.toRestore])
  report.entries = report.entries.filter((e) => !handled.has(e))
  const alive = new Set(report.entries.map((e) => e.groupId))
  report.groups = report.groups
    .filter((g) => alive.has(g.id))
    .map((g) => {
      const members = report.entries.filter((e) => e.groupId === g.id)
      return {
        ...g,
        fileCount: members.length,
        totalBytes: members.reduce((n, e) => n + e.size, 0),
        counts: {
          nuevo: members.filter((e) => e.status === 'nuevo').length,
          modificado: members.filter((e) => e.status === 'modificado').length,
          desaparecido: members.filter((e) => e.status === 'desaparecido').length
        }
      }
    })
  await saveReport(report)

  return {
    ok: true,
    report,
    moved: batch?.itemCount ?? 0,
    movedBytes: batch?.totalBytes ?? 0,
    restored,
    stuck: plan.stuck.length,
    failed
  }
})

ipcMain.handle('quarantine:list', async (_e, id?: string) =>
  id ? batches.filter((b) => b.gameId === id) : batches
)

ipcMain.handle('quarantine:restore', async (_e, batchId: string) => {
  const batch = batches.find((b) => b.id === batchId)
  if (!batch) return { ok: false, error: 'Ese lote ya no existe.' }
  const res = await restoreBatch(batch)
  batch.restored = new Date().toISOString()
  await saveQuarantine(batches)
  await deleteReport(batch.gameId)
  return { ok: true, ...res }
})

/** La única operación de todo VANTA que borra de verdad. */
ipcMain.handle('quarantine:destroy', async (_e, batchId: string) => {
  const batch = batches.find((b) => b.id === batchId)
  if (!batch) return { ok: false, error: 'Ese lote ya no existe.' }
  await destroyBatch(batch)
  batches = batches.filter((b) => b.id !== batchId)
  await saveQuarantine(batches)
  return { ok: true }
})

// =============================================================================
// 6. Perfiles y lanzador
// =============================================================================

const profilesOf = (gameId: string): Profile[] => profiles.filter((p) => p.gameId === gameId)

ipcMain.handle('profiles:list', async (_e, gameId: string) => profilesOf(gameId))
ipcMain.handle('profiles:colors', () => PROFILE_COLORS)

/** Convierte un grupo de la última revisión en un perfil montado. */
ipcMain.handle('profiles:create', async (_e, gameId: string, groupId: string, name: string, color: string) => {
  const game = gameById(gameId)
  const report = await loadReport(gameId)
  if (!game || !report) return { ok: false, error: 'Falta el juego o su revisión.' }

  // Solo lo añadido puede montarse y desmontarse. Un original modificado no
  // se puede apartar sin dejar un hueco en el juego.
  const items = report.entries
    .filter((e) => e.groupId === groupId && e.status === 'nuevo')
    .map((e) => ({ root: e.root, rel: e.rel, size: e.size }))
  if (!items.length) return { ok: false, error: 'Ese grupo no tiene archivos añadidos que mover.' }

  // Un archivo no puede pertenecer a dos perfiles: al desmontar uno, el otro
  // se quedaría sin él y ya no sabría a quién pertenece.
  const taken = new Map<string, string>()
  for (const p of profilesOf(gameId)) for (const i of p.items) taken.set(`${i.root}|${i.rel}`, p.name)
  const clash = items.find((i) => taken.has(`${i.root}|${i.rel}`))
  if (clash) {
    return {
      ok: false,
      error: `${clash.rel} ya pertenece al perfil «${taken.get(`${clash.root}|${clash.rel}`)}».`
    }
  }

  const profile: Profile = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    gameId,
    name,
    color,
    mounted: true,
    createdAt: new Date().toISOString(),
    fileCount: items.length,
    totalBytes: items.reduce((n, i) => n + i.size, 0),
    items
  }
  profiles = [...profiles, profile]
  await saveProfiles(profiles)
  return { ok: true, profile, profiles: profilesOf(gameId) }
})

ipcMain.handle('profiles:update', async (_e, id: string, patch: Partial<Profile>) => {
  const profile = profiles.find((p) => p.id === id)
  if (!profile) return null
  // Solo nombre, color y nota: lo demás lo gobierna VANTA.
  if (patch.name !== undefined) profile.name = patch.name
  if (patch.color !== undefined) profile.color = patch.color
  if (patch.note !== undefined) profile.note = patch.note
  await saveProfiles(profiles)
  return profilesOf(profile.gameId)
})

ipcMain.handle('profiles:collisions', async (_e, id: string) => {
  const profile = profiles.find((p) => p.id === id)
  const game = profile && gameById(profile.gameId)
  if (!profile || !game) return []
  return collisions(profile, rootsOf(game))
})

/** Monta o desmonta un perfil. Mover archivos deja obsoleta la última revisión. */
async function setMounted(profile: Profile, wanted: boolean) {
  const game = gameById(profile.gameId)
  if (!game) return { ok: false as const, error: 'Juego no encontrado.' }
  if (profile.mounted === wanted) return { ok: true as const, moved: 0, bytes: 0, skipped: [] }
  const roots = rootsOf(game)
  const res = wanted ? await mount(profile, roots, dataDir()) : await unmount(profile, roots, dataDir())
  profile.mounted = wanted
  await saveProfiles(profiles)
  await deleteReport(profile.gameId)
  return { ok: true as const, ...res }
}

ipcMain.handle('profiles:setMounted', async (_e, id: string, wanted: boolean) => {
  const profile = profiles.find((p) => p.id === id)
  if (!profile) return { ok: false, error: 'Ese perfil ya no existe.' }
  const res = await setMounted(profile, wanted)
  return { ...res, profiles: profilesOf(profile.gameId) }
})

ipcMain.handle('profiles:delete', async (_e, id: string) => {
  const profile = profiles.find((p) => p.id === id)
  if (!profile) return { ok: false, error: 'Ese perfil ya no existe.' }
  const game = gameById(profile.gameId)
  // Antes de borrar el perfil se devuelven sus archivos al juego.
  if (game) {
    if (!profile.mounted) await mount(profile, rootsOf(game), dataDir())
    await dropStore(profile, rootsOf(game), dataDir())
  }
  const gameId = profile.gameId
  profiles = profiles.filter((p) => p.id !== id)
  await saveProfiles(profiles)
  await deleteReport(gameId)
  return { ok: true, profiles: profilesOf(gameId) }
})

/**
 * Vigila el proceso del juego: espera a que aparezca y luego a que desaparezca.
 * Se usa para desmontar los perfiles al cerrar el juego. Consulta tasklist cada
 * cinco segundos; media hora para que arranque, seis horas de partida como tope.
 */
function watchProcess(exeName: string, onExit: () => void): void {
  if (process.platform !== 'win32') return
  let seen = false
  let ticks = 0
  const timer = setInterval(() => {
    ticks++
    if ((!seen && ticks > 360) || ticks > 4320) {
      clearInterval(timer)
      return
    }
    execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return
      const running = stdout.toLowerCase().includes(exeName.toLowerCase())
      if (running) seen = true
      else if (seen) {
        clearInterval(timer)
        onExit()
      }
    })
  }, 5000)
}

ipcMain.handle(
  'game:launch',
  async (_e, id: string, mode: 'limpio' | 'tal cual' | 'perfil', profileId: string | null, returnClean: boolean) => {
    const game = gameById(id)
    if (!game) return { ok: false, error: 'Juego no encontrado.' }

    const mine = profilesOf(id)
    const skipped: { rel: string; reason: string }[] = []

    // "limpio" desmonta todo; "perfil" desmonta todo salvo el elegido.
    if (mode === 'limpio' || mode === 'perfil') {
      for (const p of mine) {
        const res = await setMounted(p, mode === 'perfil' && p.id === profileId)
        if (res.ok && res.skipped) skipped.push(...res.skipped)
      }
    }

    const exe = game.spec?.mainExecutable
    try {
      if (game.platform === 'steam' && game.appId) {
        await shell.openExternal(`steam://rungameid/${game.appId}`)
      } else if (exe) {
        const full = absOf([game.path], 0, exe)
        spawn(full, [], { cwd: path.dirname(full), detached: true, stdio: 'ignore' }).unref()
      } else {
        return { ok: false, error: 'No sé cuál es el ejecutable. Fija la línea base primero.' }
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }

    if (returnClean && exe && mine.length) {
      watchProcess(path.posix.basename(exe), async () => {
        for (const p of profilesOf(id)) await setMounted(p, false)
        emit('profiles:changed', profilesOf(id))
      })
    }

    const history = await loadHistory(id)
    history.sessions.push({
      at: new Date().toISOString(),
      mode,
      profiles: mine.filter((p) => p.mounted).map((p) => p.name)
    })
    await saveHistory(history)

    return { ok: true, skipped, profiles: profilesOf(id), watching: returnClean && !!exe && mine.length > 0 }
  }
)

// =============================================================================
// 7. Configuraciones (archivos y registro)
// =============================================================================

/** Texto actual de una configuración, venga de un archivo o del registro. */
async function currentConfig(game: Game, root: number, rel: string): Promise<string | null> {
  if (isRegistryConfig(rel)) return dumpRegistry(registryKeyOf(rel))
  try {
    return await readFile(longPath(absOf(rootsOf(game), root, rel)), 'utf8')
  } catch {
    return null
  }
}

ipcMain.handle('config:versions', async (_e, id: string, root: number, rel: string) => {
  const index = await loadConfigIndex(dataDir(), id)
  return index.find((f) => f.root === root && f.rel === rel)?.versions ?? []
})

ipcMain.handle('config:diff', async (_e, id: string, root: number, rel: string, againstFile: string | null) => {
  const game = gameById(id)
  const format = isRegistryConfig(rel) ? ('ini' as const) : detectFormat(rel)
  if (!game || !format) return { ok: false, error: 'Ese archivo no es una configuración legible.' }

  const index = await loadConfigIndex(dataDir(), id)
  const entry = index.find((f) => f.root === root && f.rel === rel)
  if (!entry?.versions.length) {
    return { ok: false, error: 'Todavía no hay ninguna versión guardada de este archivo.' }
  }

  // Por defecto contra la de fábrica; si no la hay, contra la anterior.
  const chosen =
    entry.versions.find((v) => v.file === againstFile) ??
    entry.versions.find((v) => v.factory) ??
    entry.versions[entry.versions.length - 2] ??
    entry.versions[0]

  const before = await readVersion(dataDir(), id, entry.slug, chosen.file)
  const after = await currentConfig(game, root, rel)
  if (before == null || after == null) return { ok: false, error: 'No se pudo leer alguna de las dos versiones.' }

  return { ok: true, diff: diffConfig(before, after, format), against: chosen, versions: entry.versions }
})

ipcMain.handle(
  'config:revert',
  async (_e, id: string, root: number, rel: string, keys: { key: string; value: string }[]) => {
    const game = gameById(id)
    if (isRegistryConfig(rel)) return { ok: false, error: 'VANTA no escribe en el registro de Windows: aquí solo mira.' }
    const format = detectFormat(rel)
    if (!game || !format) return { ok: false, error: 'Ese archivo no es una configuración legible.' }
    const current = await currentConfig(game, root, rel)
    if (current == null) return { ok: false, error: 'No se pudo leer el archivo.' }

    // revertKeys verifica el resultado antes de devolverlo: si no cuadra, es null.
    const result = revertKeys(current, format, keys)
    if (!result) {
      return {
        ok: false,
        error: 'No he podido revertir esas claves sin arriesgarme a estropear el archivo. Usa la restauración completa.'
      }
    }
    try {
      await writeFile(longPath(absOf(rootsOf(game), root, rel)), result.text, 'utf8')
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    await deleteReport(id)
    return { ok: true, applied: result.applied }
  }
)

// =============================================================================
// 8. Historial, informes y ajustes
// =============================================================================

ipcMain.handle('history:load', async (_e, id: string) => loadHistory(id))

ipcMain.handle('conflicts:list', async (_e, id: string) => findConflicts(await loadReport(id)))

ipcMain.handle('report:export', async (_e, id: string) => {
  const game = gameById(id)
  if (!game || !win) return { ok: false, error: 'Juego no encontrado.' }
  const report = await loadReport(id)
  const markdown = buildMarkdown({
    game,
    report,
    profiles: profilesOf(id),
    batches: batches.filter((b) => b.gameId === id),
    history: await loadHistory(id),
    conflicts: findConflicts(report)
  })
  const res = await dialog.showSaveDialog(win, {
    title: 'Guardar el informe',
    defaultPath: `${game.name.replace(/[\\/:*?"<>|]/g, '-')} - VANTA.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false }
  await writeFile(res.filePath, markdown, 'utf8')
  return { ok: true, path: res.filePath }
})

/** Tamaño de una carpeta, recorriendo sin recursión para no reventar la pila. */
async function dirSize(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
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
        files++
        bytes += (await statFile(full).catch(() => ({ size: 0 }))).size
      }
    }
  }
  return { files, bytes }
}

ipcMain.handle('app:usage', async () => {
  const base = dataDir()
  const usage: Record<string, { files: number; bytes: number }> = {}
  for (const part of ['baselines', 'reports', 'history', 'originals', 'configs', 'art']) {
    usage[part] = await dirSize(path.join(base, part))
  }

  // Los almacenes de cuarentena y perfiles viven fuera, en cada unidad. Un
  // lote puede repartirse en varias (juego en D:, configuración en C:), así
  // que se deducen de la ruta de cada archivo y no del almacén principal.
  const stores = new Set<string>()
  for (const b of batches) {
    if (b.restored) continue
    for (const item of b.items) {
      const at = item.to.indexOf('.vanta-cuarentena')
      if (at > 0) stores.add(item.to.slice(0, at + '.vanta-cuarentena'.length))
    }
  }
  let quarantineUsage = { files: 0, bytes: 0 }
  for (const store of stores) {
    const s = await dirSize(store)
    quarantineUsage = { files: quarantineUsage.files + s.files, bytes: quarantineUsage.bytes + s.bytes }
  }
  usage.cuarentena = quarantineUsage

  const stored = profiles.filter((p) => !p.mounted)
  usage.perfiles = {
    files: stored.reduce((n, p) => n + p.fileCount, 0),
    bytes: stored.reduce((n, p) => n + p.totalBytes, 0)
  }
  return { dataDir: base, usage }
})

ipcMain.handle('app:openDataDir', async () => {
  await shell.openPath(dataDir())
})

// =============================================================================
// Ciclo de vida
// =============================================================================

// =============================================================================
// 9. Actualización automática
// =============================================================================

ipcMain.handle('update:state', () => currentUpdateState())
ipcMain.handle('update:check', () => checkForUpdates())
ipcMain.handle('update:install', () => installUpdate())

onUpdateState((state) => emit('update:state', state))

app.whenReady().then(async () => {
  // Sirve las carátulas guardadas. Solo nombres simples dentro de la carpeta
  // de arte: nada de subir niveles ni rutas absolutas.
  protocol.handle('vanta', async (request) => {
    try {
      const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
      if (!/^[a-z0-9._-]+$/i.test(name)) return new Response('', { status: 400 })
      const file = path.join(artDir(dataDir()), name)
      if (!existsSync(file)) return new Response('', { status: 404 })
      return new Response(await readFile(file), {
        headers: { 'content-type': MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream' }
      })
    } catch {
      return new Response('', { status: 500 })
    }
  })

  library = await loadLibrary()
  batches = await loadQuarantine()
  rules = await loadRules()
  profiles = await loadProfiles()
  createWindow()
  if (app.isPackaged) setTimeout(() => checkForUpdates().catch(() => {}), 8000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
