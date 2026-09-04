/**
 * Actualización automática.
 *
 * La app instalada mira las releases del repositorio de GitHub que consta en
 * package.json. Si hay una versión más alta, la descarga en segundo plano y
 * pide reiniciar. Los datos no corren peligro: viven en %APPDATA%\VANTA y el
 * instalador solo toca la carpeta del programa.
 *
 * Solo funciona en la versión instalada. Lanzada con VANTA.bat no hay nada
 * que actualizar, y se dice así en vez de fingir que busca.
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdateState =
  | { phase: 'inactivo'; reason?: string }
  | { phase: 'buscando' }
  | { phase: 'al-dia'; version: string }
  | { phase: 'disponible'; version: string; notes?: string }
  | { phase: 'descargando'; percent: number; version: string }
  | { phase: 'lista'; version: string }
  | { phase: 'error'; message: string }

let state: UpdateState = { phase: 'inactivo' }
let subscribers: ((s: UpdateState) => void)[] = []

const set = (s: UpdateState): void => {
  state = s
  for (const fn of subscribers) fn(s)
}

export const currentUpdateState = (): UpdateState => state

export function onUpdateState(fn: (s: UpdateState) => void): () => void {
  subscribers.push(fn)
  return () => {
    subscribers = subscribers.filter((f) => f !== fn)
  }
}

let wired = false

function wire(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => set({ phase: 'buscando' }))
  autoUpdater.on('update-not-available', () => set({ phase: 'al-dia', version: app.getVersion() }))
  autoUpdater.on('update-available', (info) =>
    set({
      phase: 'disponible',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    })
  )
  autoUpdater.on('download-progress', (p) =>
    set({ phase: 'descargando', percent: Math.round(p.percent), version: state.phase === 'disponible' || state.phase === 'descargando' ? state.version : '' })
  )
  autoUpdater.on('update-downloaded', (info) => set({ phase: 'lista', version: info.version }))
  autoUpdater.on('error', (err) => set({ phase: 'error', message: err?.message ?? String(err) }))
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    set({
      phase: 'inactivo',
      reason: 'Estás usando VANTA.bat. La actualización automática solo funciona en la versión instalada.'
    })
    return state
  }
  wire()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ phase: 'error', message: (err as Error).message })
  }
  return state
}

export function installUpdate(): void {
  if (state.phase !== 'lista') return
  autoUpdater.quitAndInstall(false, true)
}
