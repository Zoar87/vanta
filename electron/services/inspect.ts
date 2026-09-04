/**
 * Dos cosas que solo se pueden hacer teniendo la línea base de varios juegos.
 *
 *   1. Cruzar huellas entre juegos: saber dónde más tienes puesto un archivo, y
 *      si en algún sitio te quedó una versión distinta.
 *   2. Contar todo lo que se sabe de un archivo suelto sin salir de VANTA.
 */

import { stat, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ChangeReport, FileReport, Game, SharedFile } from '../../shared/types'
import { readPe } from './pe'
import { longPath } from './fsx'

export interface CrossInput {
  games: Game[]
  reports: Map<string, ChangeReport>
}

/**
 * Busca archivos añadidos que estén en más de un juego.
 *
 * Se compara solo lo añadido, no los originales: que dos juegos compartan un
 * runtime de Microsoft no dice nada, pero que compartan una DLL de ReShade sí.
 */
export function crossReference(input: CrossInput): SharedFile[] {
  interface Sitio {
    gameId: string
    gameName: string
    rel: string
    sha256: string
    size: number
    group?: string
  }

  const porNombre = new Map<string, Sitio[]>()
  for (const game of input.games) {
    const report = input.reports.get(game.id)
    if (!report) continue
    const grupo = new Map(report.groups.map((g) => [g.id, g]))
    for (const e of report.entries) {
      if (e.status !== 'nuevo' || !e.sha256) continue
      const g = grupo.get(e.groupId)
      // Lo protegido y los respaldos no son "cosas que has instalado".
      if (g && ['partida', 'ausente', 'respaldo'].includes(g.category)) continue
      const base = path.posix.basename(e.rel).toLowerCase()
      const lista = porNombre.get(base) ?? []
      lista.push({
        gameId: game.id,
        gameName: game.name,
        rel: e.rel,
        sha256: e.sha256,
        size: e.size,
        group: g?.name
      })
      porNombre.set(base, lista)
    }
  }

  const salida: SharedFile[] = []
  for (const [nombre, sitios] of porNombre) {
    const juegos = new Set(sitios.map((s) => s.gameId))
    if (juegos.size < 2) continue

    // La huella mayoritaria manda; el resto se listan como versiones distintas.
    const porHuella = new Map<string, Sitio[]>()
    for (const s of sitios) porHuella.set(s.sha256, [...(porHuella.get(s.sha256) ?? []), s])
    const [huella, iguales] = [...porHuella.entries()].sort((a, b) => b[1].length - a[1].length)[0]

    salida.push({
      rel: nombre,
      sha256: huella,
      size: iguales[0].size,
      places: iguales.map((s) => ({
        gameId: s.gameId,
        gameName: s.gameName,
        rel: s.rel,
        group: s.group
      })),
      variants: sitios
        .filter((s) => s.sha256 !== huella)
        .map((s) => ({
          gameId: s.gameId,
          gameName: s.gameName,
          rel: s.rel,
          sha256: s.sha256,
          size: s.size
        }))
    })
  }

  return salida.sort(
    (a, b) => b.places.length + b.variants.length - (a.places.length + a.variants.length)
  )
}

const TEXTO = /\.(txt|ini|cfg|conf|log|json|xml|yaml|yml|toml|md|fx|fxh|hlsl|lua|py|bat|cmd|ps1|csv|properties|settings|prefs|addon|asi)$/i

/** Todo lo que se puede saber de un archivo con solo mirarlo. */
export async function inspectFile(
  roots: string[],
  root: number,
  rel: string,
  report: ChangeReport | null
): Promise<FileReport> {
  const abs = path.join(roots[root] ?? '', rel.split('/').join(path.sep))
  const ficha: FileReport = { rel, abs, exists: false, size: 0, isText: false }

  const entrada = report?.entries.find((e) => e.root === root && e.rel === rel)
  if (entrada) {
    ficha.status = entrada.status
    ficha.sha256 = entrada.sha256
    ficha.baselineSha256 = entrada.baselineSha256
    ficha.group = report?.groups.find((g) => g.id === entrada.groupId)?.name
  }

  if (!existsSync(longPath(abs))) return ficha

  try {
    const info = await stat(longPath(abs))
    ficha.exists = true
    ficha.size = info.size
    ficha.created = new Date(info.birthtimeMs || info.ctimeMs).toISOString()
    ficha.modified = new Date(info.mtimeMs).toISOString()
  } catch {
    return ficha
  }

  // Cabecera PE: quién dice ser, qué enlaza y si va firmado.
  if (/\.(dll|exe|asi|node|ocx|sys)$/i.test(rel)) {
    ficha.pe = (await readPe(abs)) ?? undefined
  }

  // Un vistazo a las primeras líneas, si es texto y no pesa demasiado.
  if (TEXTO.test(rel) && ficha.size > 0 && ficha.size < 4 * 1024 * 1024) {
    let fh
    try {
      fh = await open(longPath(abs), 'r')
      const buf = Buffer.alloc(Math.min(2048, ficha.size))
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
      const trozo = buf.subarray(0, bytesRead)
      // Si trae bytes nulos es binario disfrazado de texto: mejor no enseñarlo.
      if (!trozo.includes(0)) {
        ficha.isText = true
        ficha.preview = trozo.toString('utf8').split(/\r?\n/).slice(0, 24).join('\n')
      }
    } catch {
      /* sin permisos */
    } finally {
      await fh?.close().catch(() => {})
    }
  }

  // Si no venía de la revisión, se calcula la huella al vuelo.
  if (!ficha.sha256 && ficha.exists && ficha.size < 256 * 1024 * 1024) {
    try {
      const { createReadStream } = await import('node:fs')
      ficha.sha256 = await new Promise<string>((resolve, reject) => {
        const h = createHash('sha256')
        const s = createReadStream(longPath(abs))
        s.on('error', reject)
        s.on('data', (c) => h.update(c))
        s.on('end', () => resolve(h.digest('hex')))
      })
    } catch {
      /* archivo bloqueado */
    }
  }

  return ficha
}
