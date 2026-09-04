/**
 * Carátulas e iconos.
 *
 * Tres fuentes, de mejor a peor, todas locales y sin pedir nada a internet:
 *
 *   1. La caché de arte de Steam. El cliente ya se ha descargado la carátula
 *      vertical y la cabecera de cada juego que tienes instalado, así que la
 *      biblioteca de VANTA se ve igual que la de Steam sin descargar nada.
 *   2. El .ico que GOG deja en la carpeta del juego.
 *   3. El icono incrustado en el propio ejecutable, extraído de sus recursos.
 *
 * Lo encontrado se copia a la carpeta de datos de VANTA para no depender de
 * que Steam mantenga su caché ni volver a leer el ejecutable en cada arranque.
 */

import { readdir, copyFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Game, GameArt } from '../../shared/types'
import { steamRoot } from './detect'
import { readIcon } from './pe'

const safe = (s: string): string => s.replace(/[^a-z0-9._-]/gi, '_')
export const artDir = (dataDir: string): string => path.join(dataDir, 'art')

const IMAGE = /\.(jpg|jpeg|png|ico)$/i

/** Puntúa un nombre de archivo de la caché de Steam según lo que buscamos. */
function score(name: string, want: 'cover' | 'hero' | 'icon' | 'logo'): number {
  const n = name.toLowerCase()
  if (want === 'cover') {
    if (n.includes('600x900')) return 100
    if (n.includes('portrait')) return 80
    if (n.includes('capsule') && !n.includes('231x87')) return 40
    return 0
  }
  if (want === 'hero') {
    if (n.includes('library_hero')) return 100
    if (n.includes('header')) return 90
    if (n.includes('hero')) return 70
    return 0
  }
  if (want === 'logo') {
    // El logotipo es el título del juego recortado sobre fondo transparente.
    if (n.includes('logo')) return 100
    return 0
  }
  if (n.includes('icon')) return 100
  return 0
}

async function steamCacheFiles(appId: string): Promise<string[]> {
  const root = await steamRoot()
  if (!root) return []
  const cache = path.join(root, 'appcache', 'librarycache')
  const out: string[] = []

  // Disposición nueva: una subcarpeta por juego.
  const folder = path.join(cache, appId)
  if (existsSync(folder)) {
    try {
      for (const f of await readdir(folder)) {
        if (IMAGE.test(f)) out.push(path.join(folder, f))
      }
    } catch {
      /* carpeta ilegible */
    }
  }

  // Disposición antigua: todo plano con el appid por delante.
  try {
    for (const f of await readdir(cache)) {
      if (f.startsWith(`${appId}_`) && IMAGE.test(f)) out.push(path.join(cache, f))
    }
  } catch {
    /* sin caché */
  }
  return out
}

function best(files: string[], want: 'cover' | 'hero' | 'icon' | 'logo'): string | null {
  let winner: { file: string; points: number } | null = null
  for (const file of files) {
    const points = score(path.basename(file), want)
    if (points > 0 && (!winner || points > winner.points)) winner = { file, points }
  }
  return winner?.file ?? null
}

async function copyInto(target: string, from: string): Promise<boolean> {
  try {
    const info = await stat(from)
    if (!info.isFile() || info.size === 0) return false
    await copyFile(from, target)
    return true
  } catch {
    return false
  }
}

export async function resolveArt(game: Game, dataDir: string): Promise<GameArt | null> {
  const dir = artDir(dataDir)
  await mkdir(dir, { recursive: true })
  const id = safe(game.id)
  const art: GameArt = { source: 'ninguna', resolvedAt: new Date().toISOString() }

  // --- 1. caché de Steam ---
  if (game.platform === 'steam' && game.appId) {
    const files = await steamCacheFiles(game.appId)
    if (files.length) {
      const cover = best(files, 'cover')
      const hero = best(files, 'hero')
      const icon = best(files, 'icon')
      const logo = best(files, 'logo')
      if (cover && (await copyInto(path.join(dir, `${id}-cover${path.extname(cover)}`), cover))) {
        art.cover = `${id}-cover${path.extname(cover)}`
      }
      if (hero && (await copyInto(path.join(dir, `${id}-hero${path.extname(hero)}`), hero))) {
        art.hero = `${id}-hero${path.extname(hero)}`
      }
      if (icon && (await copyInto(path.join(dir, `${id}-icon${path.extname(icon)}`), icon))) {
        art.icon = `${id}-icon${path.extname(icon)}`
      }
      if (logo && (await copyInto(path.join(dir, `${id}-logo${path.extname(logo)}`), logo))) {
        art.logo = `${id}-logo${path.extname(logo)}`
      }
      if (art.cover || art.hero || art.icon || art.logo) {
        art.source = 'caché de Steam'
        return art
      }
    }
  }

  // --- 2. el .ico que dejan GOG y algunos instaladores ---
  try {
    const rootFiles = await readdir(game.path, { withFileTypes: true })
    const ico = rootFiles.find(
      (f) => f.isFile() && (/^goggame-\d+\.ico$/i.test(f.name) || /\.ico$/i.test(f.name))
    )
    if (ico && (await copyInto(path.join(dir, `${id}-icon.ico`), path.join(game.path, ico.name)))) {
      art.icon = `${id}-icon.ico`
      art.source = 'icono de la carpeta del juego'
      return art
    }
  } catch {
    /* carpeta inaccesible */
  }

  // --- 3. el icono incrustado en el ejecutable ---
  const exe = game.spec?.mainExecutable
  if (exe) {
    const abs = path.join(game.path, exe.split('/').join(path.sep))
    const ico = await readIcon(abs)
    if (ico) {
      try {
        await writeFile(path.join(dir, `${id}-icon.ico`), ico)
        art.icon = `${id}-icon.ico`
        art.source = 'icono del ejecutable'
        return art
      } catch {
        /* no se pudo escribir */
      }
    }
  }

  return art.cover || art.hero || art.icon || art.logo ? art : null
}
