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

import { readdir, copyFile, mkdir, writeFile, stat, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Game, GameArt } from '../../shared/types'
import { steamRoot } from './detect'
import { readIcon } from './pe'

const safe = (s: string): string => s.replace(/[^a-z0-9._-]/gi, '_')
export const artDir = (dataDir: string): string => path.join(dataDir, 'art')

const IMAGE = /\.(jpg|jpeg|png|ico)$/i

interface ImageInfo {
  width: number
  height: number
  alpha: boolean
}

/**
 * Mide una imagen leyendo solo su cabecera, sin descodificarla.
 *
 * Hace falta porque Steam ha ido cambiando cómo nombra los archivos de su
 * caché: en las entradas nuevas ya no se llaman library_600x900.jpg sino con
 * un identificador sin sentido. Por el nombre no hay nada que rascar, pero las
 * proporciones no mienten: lo alto es la carátula, lo muy ancho la cabecera, y
 * lo cuadrado y pequeño el icono.
 */
async function imageInfo(file: string): Promise<ImageInfo | null> {
  let fh
  try {
    fh = await open(file, 'r')
    const head = Buffer.alloc(65536)
    const { bytesRead } = await fh.read(head, 0, head.length, 0)
    const buf = head.subarray(0, bytesRead)

    // PNG: la cabecera IHDR está siempre en la misma posición.
    if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47) {
      const colorType = buf[25]
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        alpha: colorType === 4 || colorType === 6 || colorType === 3
      }
    }

    // JPEG: hay que recorrer los segmentos hasta dar con el de inicio de marco.
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++
          continue
        }
        const marker = buf[i + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        const length = buf.readUInt16BE(i + 2)
        const isFrame =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        if (isFrame) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), alpha: false }
        }
        i += 2 + length
      }
    }
    return null
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}

/** Clasifica una imagen por sus proporciones cuando el nombre no dice nada. */
function shapeOf(info: ImageInfo, isPng: boolean): 'cover' | 'hero' | 'logo' | 'icon' | null {
  const { width: w, height: h } = info
  if (!w || !h) return null
  const ratio = w / h
  if (ratio < 0.85) return 'cover' // vertical: 600x900 y parecidos
  if (w <= 320 && ratio > 0.85 && ratio < 1.2) return 'icon' // cuadrada y pequeña
  if (ratio >= 1.9) return 'hero' // muy apaisada: cabecera o fondo
  if (isPng && info.alpha) return 'logo' // el logotipo va recortado sobre transparencia
  if (ratio >= 1.2) return 'hero'
  return null
}

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
      let cover = best(files, 'cover')
      let hero = best(files, 'hero')
      let icon = best(files, 'icon')
      let logo = best(files, 'logo')

      // Lo que no se haya podido identificar por el nombre, se mide.
      const missing = !cover || !hero || !icon || !logo
      if (missing) {
        const named = new Set([cover, hero, icon, logo].filter(Boolean) as string[])
        const measured: { file: string; shape: string; area: number }[] = []
        for (const file of files) {
          if (named.has(file)) continue
          const info = await imageInfo(file)
          if (!info) continue
          const shape = shapeOf(info, /\.png$/i.test(file))
          if (shape) measured.push({ file, shape, area: info.width * info.height })
        }
        // Ante varias candidatas de la misma forma, gana la de más resolución.
        const pick = (shape: string): string | null =>
          measured
            .filter((m) => m.shape === shape)
            .sort((a, b) => b.area - a.area)[0]?.file ?? null
        cover = cover ?? pick('cover')
        hero = hero ?? pick('hero')
        icon = icon ?? pick('icon')
        logo = logo ?? pick('logo')
      }
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
