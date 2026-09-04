/**
 * Busca las carpetas que un juego usa fuera de su propio directorio:
 * Documentos\My Games, AppData\Local y AppData\Roaming.
 *
 * Estas carpetas son territorio compartido con todo Windows, así que no se
 * escanean enteras: se proponen candidatas por parecido de nombre y las
 * confirmas tú. Las que contienen partidas guardadas quedan protegidas.
 */

import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { LinkedPath } from '../../shared/types'

const SAVE_HINTS = /^(save|saves|savegame|savegames|savedata|savefiles|storage|slots?)$/i

/** Carpetas que pertenecen a un gestor de mods, no al juego. */
const MANAGER_ROOTS = /[\\/](vortex|mod organizer|modorganizer|mo2|nexus mod manager|wabbajack|thunderstore|r2modman|gale)([\\/]|$)/i

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Puntuación de parecido simple: contención por ambos lados sobre el nombre normalizado. */
function similar(a: string, b: string): boolean {
  const x = normalise(a)
  const y = normalise(b)
  if (!x || !y || y.length < 4) return false
  return x.includes(y) || y.includes(x)
}

async function candidatesIn(
  base: string,
  kind: LinkedPath['kind'],
  gameName: string,
  depth: number
): Promise<LinkedPath[]> {
  if (!existsSync(base)) return []
  const out: LinkedPath[] = []
  let entries
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(base, entry.name)
    if (MANAGER_ROOTS.test(full)) {
      // Un gestor de mods es territorio suyo: se vigila, pero nunca se
      // confunde con partidas guardadas ni se purga desde aquí.
      out.push({ path: full, kind: 'gestor', label: `${entry.name} (gestor de mods)`, protected: false })
    } else if (similar(gameName, entry.name)) {
      out.push({
        path: full,
        kind,
        label: entry.name,
        protected: await containsSaves(full)
      })
    } else if (depth > 0) {
      // Un nivel más adentro cubre el caso Editor\Juego (por ejemplo Guerrilla\Horizon).
      out.push(...(await candidatesIn(full, kind, gameName, depth - 1)))
    }
  }
  return out
}

async function containsSaves(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.some((e) => e.isDirectory() && SAVE_HINTS.test(e.name))
  } catch {
    return false
  }
}

export async function suggestLinkedPaths(gameName: string): Promise<LinkedPath[]> {
  if (process.platform !== 'win32') return []
  const home = os.homedir()
  const roots: [string, LinkedPath['kind'], number][] = [
    [path.join(home, 'Documents', 'My Games'), 'documentos', 1],
    [path.join(home, 'Documents'), 'documentos', 0],
    [path.join(home, 'Saved Games'), 'documentos', 0],
    [path.join(home, 'AppData', 'Local'), 'appdata-local', 1],
    [path.join(home, 'AppData', 'LocalLow'), 'appdata-local', 1],
    [path.join(home, 'AppData', 'Roaming'), 'appdata-roaming', 2]
  ]
  const found: LinkedPath[] = []
  for (const [base, kind, depth] of roots) {
    found.push(...(await candidatesIn(base, kind, gameName, depth)))
  }
  const seen = new Set<string>()
  return found.filter((f) => {
    const key = f.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
