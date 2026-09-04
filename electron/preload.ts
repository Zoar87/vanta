/**
 * Puente entre la interfaz y el proceso principal.
 *
 * La interfaz no tiene acceso a Node ni a Electron: solo a este objeto,
 * expuesto como window.vanta. Cada función aquí corresponde a un manejador
 * IPC del proceso principal, y el tipo VantaApi se exporta para que la
 * interfaz sepa exactamente qué puede llamar y qué devuelve.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  Category, ChangeReport, Conflict, ConfigVersion, FileReport, Game, GameHistory, LinkedPath,
  SharedFile, TimeCluster, UpdateAlert,
  Profile, QuarantineBatch, LearnedRule, ScanProgress
} from '../shared/types'

const api = {
  info: () => ipcRenderer.invoke('app:info'),

  listGames: (): Promise<Game[]> => ipcRenderer.invoke('library:list'),
  detect: () => ipcRenderer.invoke('games:detect'),
  addGames: (games: Partial<Game>[]): Promise<Game[]> => ipcRenderer.invoke('library:add', games),
  pickFolder: (): Promise<{ path: string; name: string } | null> =>
    ipcRenderer.invoke('library:addFolder'),
  removeGame: (id: string, options?: { restoreQuarantine?: boolean }) =>
    ipcRenderer.invoke('library:remove', id, options),
  removePreview: (id: string) => ipcRenderer.invoke('library:removePreview', id),
  usage: () => ipcRenderer.invoke('app:usage'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  timeline: (id: string): Promise<TimeCluster[]> => ipcRenderer.invoke('changes:timeline', id),
  pendingUpdates: (): Promise<UpdateAlert[]> => ipcRenderer.invoke('library:updates'),
  sharedFiles: (): Promise<SharedFile[]> => ipcRenderer.invoke('library:shared'),
  inspectFile: (id: string, root: number, rel: string): Promise<FileReport | null> =>
    ipcRenderer.invoke('file:inspect', id, root, rel),
  setNote: (id: string, note: string) => ipcRenderer.invoke('game:note', id, note),

  updateState: () => ipcRenderer.invoke('update:state'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb: (s: unknown) => void) => {
    const handler = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('update:state', handler)
    return () => {
      ipcRenderer.off('update:state', handler)
    }
  },
  updateGame: (id: string, patch: Partial<Game>): Promise<Game | null> =>
    ipcRenderer.invoke('library:update', id, patch),

  suggestLinks: (id: string): Promise<LinkedPath[]> => ipcRenderer.invoke('game:suggestLinks', id),
  buildId: (id: string): Promise<string | undefined> => ipcRenderer.invoke('game:buildId', id),

  startScan: (id: string) => ipcRenderer.invoke('scan:start', id),
  cancelScan: (id: string) => ipcRenderer.invoke('scan:cancel', id),
  peekBaseline: (id: string, limit = 200) => ipcRenderer.invoke('baseline:peek', id, limit),

  reveal: (target: string) => ipcRenderer.invoke('shell:reveal', target),

  // --- bloque 2 ---
  loadChanges: (id: string): Promise<ChangeReport | null> => ipcRenderer.invoke('changes:load', id),
  scanChanges: (id: string, deep = false) => ipcRenderer.invoke('changes:scan', id, deep),
  nameGroup: (id: string, groupId: string, name: string, category: Category, remember: boolean) =>
    ipcRenderer.invoke('group:name', id, groupId, name, category, remember),
  purgePreview: (id: string, groupId: string | null) =>
    ipcRenderer.invoke('purge:preview', id, groupId),
  purgeRun: (id: string, groupId: string | null) => ipcRenderer.invoke('purge:run', id, groupId),
  restoreOriginal: (id: string, root: number, rel: string) =>
    ipcRenderer.invoke('original:restore', id, root, rel),
  measureOriginals: (id: string) => ipcRenderer.invoke('originals:measure', id),
  undoRenames: (id: string, groupId: string) => ipcRenderer.invoke('rename:undo', id, groupId),
  refreshArt: (id: string) => ipcRenderer.invoke('art:refresh', id),
  validateOnSteam: (id: string) => ipcRenderer.invoke('steam:validate', id),
  reanalyze: (id: string) => ipcRenderer.invoke('game:reanalyze', id),
  baselinePreview: (id: string): Promise<{
    mounted: { id: string; name: string }[]
    unmounted: { id: string; name: string }[]
  }> => ipcRenderer.invoke('scan:baselinePreview', id),

  // --- bloque 3 ---
  listProfiles: (gameId: string): Promise<Profile[]> => ipcRenderer.invoke('profiles:list', gameId),
  profileColors: (): Promise<string[]> => ipcRenderer.invoke('profiles:colors'),
  createProfile: (gameId: string, groupId: string, name: string, color: string) =>
    ipcRenderer.invoke('profiles:create', gameId, groupId, name, color),
  updateProfile: (id: string, patch: Partial<Profile>) =>
    ipcRenderer.invoke('profiles:update', id, patch),
  profileCollisions: (id: string): Promise<string[]> =>
    ipcRenderer.invoke('profiles:collisions', id),
  setProfileMounted: (id: string, mounted: boolean) =>
    ipcRenderer.invoke('profiles:setMounted', id, mounted),
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id),

  launch: (
    id: string,
    mode: 'limpio' | 'tal cual' | 'perfil',
    profileId: string | null,
    returnClean: boolean
  ) => ipcRenderer.invoke('game:launch', id, mode, profileId, returnClean),

  loadHistory: (id: string): Promise<GameHistory> => ipcRenderer.invoke('history:load', id),
  listConflicts: (id: string): Promise<Conflict[]> => ipcRenderer.invoke('conflicts:list', id),
  exportReport: (id: string) => ipcRenderer.invoke('report:export', id),

  configVersions: (id: string, root: number, rel: string): Promise<ConfigVersion[]> =>
    ipcRenderer.invoke('config:versions', id, root, rel),
  configDiff: (id: string, root: number, rel: string, against: string | null) =>
    ipcRenderer.invoke('config:diff', id, root, rel, against),
  configRevert: (id: string, root: number, rel: string, keys: { key: string; value: string }[]) =>
    ipcRenderer.invoke('config:revert', id, root, rel, keys),

  listQuarantine: (id?: string): Promise<QuarantineBatch[]> =>
    ipcRenderer.invoke('quarantine:list', id),
  restoreQuarantine: (batchId: string) => ipcRenderer.invoke('quarantine:restore', batchId),
  destroyQuarantine: (batchId: string) => ipcRenderer.invoke('quarantine:destroy', batchId),

  listRules: (): Promise<LearnedRule[]> => ipcRenderer.invoke('rules:list'),
  removeRule: (ruleId: string) => ipcRenderer.invoke('rules:remove', ruleId),

  onScanProgress: (cb: (p: ScanProgress) => void) => {
    const handler = (_e: unknown, p: ScanProgress) => cb(p)
    ipcRenderer.on('scan:progress', handler)
    return () => {
      ipcRenderer.off('scan:progress', handler)
    }
  },
  onProfilesChanged: (cb: (profiles: Profile[]) => void) => {
    const handler = (_e: unknown, p: Profile[]) => cb(p)
    ipcRenderer.on('profiles:changed', handler)
    return () => {
      ipcRenderer.off('profiles:changed', handler)
    }
  },
  onLibraryChanged: (cb: (games: Game[]) => void) => {
    const handler = (_e: unknown, games: Game[]) => cb(games)
    ipcRenderer.on('library:changed', handler)
    return () => {
      ipcRenderer.off('library:changed', handler)
    }
  }
}

contextBridge.exposeInMainWorld('vanta', api)

export type VantaApi = typeof api
