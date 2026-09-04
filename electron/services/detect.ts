/**
 * Encuentra los juegos ya instalados leyendo lo que cada tienda deja escrito
 * en el disco. Nada de adivinar: Steam, Epic y GOG publican su inventario.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { DetectResult, Game, Platform } from '../../shared/types'

const run = promisify(execFile)

// ---------------------------------------------------------------- registro

async function regQuery(key: string, value?: string): Promise<string | null> {
  if (process.platform !== 'win32') return null
  try {
    const args = ['query', key]
    if (value) args.push('/v', value)
    const { stdout } = await run('reg', args, { windowsHide: true })
    if (!value) return stdout
    const line = stdout.split(/\r?\n/).find((l) => l.trim().startsWith(value))
    if (!line) return null
    const parts = line.trim().split(/\s{2,}/)
    return parts.length >= 3 ? parts.slice(2).join('    ').trim() : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------- VDF

/** Lector del formato KeyValues de Valve (libraryfolders.vdf, appmanifest_*.acf). */
export function parseVdf(text: string): Record<string, any> {
  const root: Record<string, any> = {}
  const stack: Record<string, any>[] = [root]
  let pendingKey: string | null = null
  let i = 0

  const readQuoted = (): string => {
    i++ // comilla de apertura
    let out = ''
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\' && i + 1 < text.length) {
        i++
        out += text[i] === 'n' ? '\n' : text[i] === 't' ? '\t' : text[i]
      } else {
        out += text[i]
      }
      i++
    }
    i++ // comilla de cierre
    return out
  }

  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '"') {
      const token = readQuoted()
      if (pendingKey === null) {
        pendingKey = token
      } else {
        stack[stack.length - 1][pendingKey] = token
        pendingKey = null
      }
    } else if (c === '{') {
      const child: Record<string, any> = {}
      if (pendingKey !== null) {
        stack[stack.length - 1][pendingKey] = child
        pendingKey = null
      }
      stack.push(child)
      i++
    } else if (c === '}') {
      if (stack.length > 1) stack.pop()
      i++
    } else {
      i++
    }
  }
  return root
}

// ----------------------------------------------------------------- Steam

export async function steamRoot(): Promise<string | null> {
  const fromReg =
    (await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath')) ??
    (await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'))
  const candidates = [
    fromReg?.replace(/\//g, '\\'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam'
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(path.join(c, 'steamapps'))) return c
  return null
}

async function steamLibraries(root: string): Promise<string[]> {
  const libs = new Set<string>([root])
  const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf')
  try {
    const parsed = parseVdf(await readFile(vdf, 'utf8'))
    const folders = parsed['libraryfolders'] ?? parsed['LibraryFolders'] ?? {}
    for (const entry of Object.values<any>(folders)) {
      const p = typeof entry === 'string' ? entry : entry?.path
      if (typeof p === 'string' && p.trim()) libs.add(p.replace(/\\\\/g, '\\'))
    }
  } catch {
    /* biblioteca única */
  }
  return [...libs].filter((l) => existsSync(path.join(l, 'steamapps')))
}

async function detectSteam(notes: string[]): Promise<DetectResult['games']> {
  const root = await steamRoot()
  if (!root) {
    notes.push('Steam no encontrado.')
    return []
  }
  const games: DetectResult['games'] = []
  for (const lib of await steamLibraries(root)) {
    const appsDir = path.join(lib, 'steamapps')
    let entries: string[] = []
    try {
      entries = await readdir(appsDir)
    } catch {
      continue
    }
    for (const file of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue
      try {
        const state = parseVdf(await readFile(path.join(appsDir, file), 'utf8'))['AppState']
        if (!state?.installdir) continue
        const dir = path.join(appsDir, 'common', state.installdir)
        if (!existsSync(dir)) continue
        // Las herramientas y runtimes de Valve no son juegos.
        if (/^(Steamworks|Proton|Steam Linux Runtime|SteamVR)/i.test(state.name ?? '')) continue
        games.push({
          id: `steam:${state.appid}`,
          name: state.name ?? state.installdir,
          path: dir,
          platform: 'steam' as Platform,
          appId: String(state.appid),
          buildId: state.buildid ? String(state.buildid) : undefined
        })
      } catch {
        /* manifiesto corrupto, siguiente */
      }
    }
  }
  return games
}

// ------------------------------------------------------------------ Epic

async function detectEpic(notes: string[]): Promise<DetectResult['games']> {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'
  if (!existsSync(dir)) {
    notes.push('Epic Games no encontrado.')
    return []
  }
  const games: DetectResult['games'] = []
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.item')) continue
    try {
      const m = JSON.parse(await readFile(path.join(dir, file), 'utf8'))
      if (!m.InstallLocation || !existsSync(m.InstallLocation)) continue
      games.push({
        id: `epic:${m.AppName ?? m.InstallationGuid ?? file}`,
        name: m.DisplayName ?? path.basename(m.InstallLocation),
        path: m.InstallLocation,
        platform: 'epic' as Platform,
        appId: m.AppName,
        buildId: m.AppVersionString ?? m.BuildVersion
      })
    } catch {
      /* manifiesto ilegible */
    }
  }
  return games
}

// ------------------------------------------------------------------- GOG

async function detectGog(notes: string[]): Promise<DetectResult['games']> {
  const dump = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games')
  if (!dump) {
    notes.push('GOG no encontrado.')
    return []
  }
  const games: DetectResult['games'] = []
  const blocks = dump.split(/\r?\n\r?\n/)
  for (const block of blocks) {
    const idMatch = block.match(/\\Games\\(\d+)/)
    const nameMatch = block.match(/^\s*gameName\s+REG_SZ\s+(.+)$/m)
    const pathMatch = block.match(/^\s*path\s+REG_SZ\s+(.+)$/m)
    if (!idMatch || !pathMatch) continue
    const dir = pathMatch[1].trim()
    if (!existsSync(dir)) continue
    games.push({
      id: `gog:${idMatch[1]}`,
      name: nameMatch?.[1].trim() ?? path.basename(dir),
      path: dir,
      platform: 'gog' as Platform,
      appId: idMatch[1]
    })
  }
  return games
}

// --------------------------------------------------------------- fachada

export async function detectGames(): Promise<DetectResult> {
  const notes: string[] = []
  if (process.platform !== 'win32') {
    return { games: [], notes: ['La detección automática solo funciona en Windows.'] }
  }
  const [steam, epic, gog] = await Promise.all([
    detectSteam(notes),
    detectEpic(notes),
    detectGog(notes)
  ])
  const all = [...steam, ...epic, ...gog]
  const seen = new Set<string>()
  const unique = all.filter((g) => {
    const key = g.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  notes.push('Xbox y Game Pass todavía no se detectan solos: añádelos con "Añadir carpeta".')
  return { games: unique, notes }
}

/** Relee el buildid de Steam para saber si el juego se ha actualizado. */
export async function currentBuildId(game: Game): Promise<string | undefined> {
  if (game.platform !== 'steam' || !game.appId) return undefined
  const appsDir = path.resolve(game.path, '..', '..')
  const manifest = path.join(appsDir, `appmanifest_${game.appId}.acf`)
  try {
    await stat(manifest)
    const state = parseVdf(await readFile(manifest, 'utf8'))['AppState']
    return state?.buildid ? String(state.buildid) : undefined
  } catch {
    return undefined
  }
}
