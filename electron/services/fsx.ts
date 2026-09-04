/**
 * Utilidades de sistema de archivos que usan varios servicios.
 *
 * Están aquí para que cuarentena, perfiles y originales muevan y creen
 * carpetas exactamente de la misma manera: con rutas largas, de forma atómica
 * cuando se puede, y sin repetir el mismo código tres veces.
 */

import { mkdir, rename, copyFile, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'

/**
 * Windows corta las rutas a 260 caracteres salvo que lleven este prefijo.
 * Los mods de Bethesda lo superan con facilidad, así que se aplica siempre.
 */
export function longPath(p: string): string {
  if (process.platform !== 'win32') return p
  if (p.startsWith('\\\\?\\')) return p
  if (p.startsWith('\\\\')) return '\\\\?\\UNC\\' + p.slice(2)
  return '\\\\?\\' + p
}

/**
 * Mueve un archivo creando las carpetas que hagan falta.
 *
 * Primero intenta renombrar, que es instantáneo dentro de la misma unidad. Si
 * el destino está en otra unidad el renombrado falla, y entonces copia y borra.
 */
export async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(longPath(path.dirname(to)), { recursive: true })
  try {
    await rename(longPath(from), longPath(to))
  } catch {
    await copyFile(longPath(from), longPath(to))
    await unlink(longPath(from))
  }
}

/**
 * Marca una carpeta como oculta en Windows. El prefijo con punto no basta:
 * en Windows no significa nada. Es solo cosmético y nunca puede fallar.
 */
export function hideOnWindows(dir: string): void {
  if (process.platform !== 'win32') return
  execFile('attrib', ['+h', dir], { windowsHide: true }, () => {})
}

/** Convierte una ruta relativa con barras normales a la ruta absoluta del sistema. */
export const absOf = (roots: string[], root: number, rel: string): string =>
  path.join(roots[root] ?? '', rel.split('/').join(path.sep))

/** Nombre seguro para usar como carpeta o archivo. */
export const safeName = (s: string): string => s.replace(/[^a-z0-9._-]/gi, '_')
