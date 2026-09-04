/**
 * Estado global de la interfaz (Zustand) y utilidades de formato compartidas:
 * tamaños, recuentos, duraciones y fechas en español.
 */

import { create } from 'zustand'
import type { Game, ScanProgress } from '../shared/types'

export interface DetectedGame extends Omit<Game, 'linkedPaths' | 'addedAt'> {
  alreadyAdded: boolean
}

interface State {
  games: Game[]
  selectedId: string | null
  filter: string
  scans: Record<string, ScanProgress>
  lastError: string | null
  ready: boolean

  load: () => Promise<void>
  select: (id: string | null) => void
  setFilter: (v: string) => void
  setGames: (games: Game[]) => void
  setProgress: (p: ScanProgress) => void
  setError: (e: string | null) => void
}

export const useStore = create<State>((set) => ({
  games: [],
  selectedId: null,
  filter: '',
  scans: {},
  lastError: null,
  ready: false,

  load: async () => {
    const games = await window.vanta.listGames()
    set((s) => ({ games, ready: true, selectedId: s.selectedId ?? games[0]?.id ?? null }))
  },
  select: (id) => set({ selectedId: id }),
  setFilter: (filter) => set({ filter }),
  setGames: (games) =>
    set((s) => ({
      games,
      selectedId: games.some((g) => g.id === s.selectedId) ? s.selectedId : (games[0]?.id ?? null)
    })),
  setProgress: (p) => set((s) => ({ scans: { ...s.scans, [p.gameId]: p } })),
  setError: (lastError) => set({ lastError })
}))

// -------------------------------------------------------------- formato

export function bytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  const decimals = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0
  return `${v.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${units[i]}`
}

export function count(n: number): string {
  return n.toLocaleString('es-ES')
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 90) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s - m * 60)} s`
}

export function dateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
}

export const PLATFORM_LABEL: Record<string, string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  manual: 'Carpeta'
}

export const API_LABEL: Record<string, string> = {
  dx9: 'DirectX 9',
  dx10: 'DirectX 10',
  dx11: 'DirectX 11',
  dx12: 'DirectX 12',
  vulkan: 'Vulkan',
  opengl: 'OpenGL'
}
