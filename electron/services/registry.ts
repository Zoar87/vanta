/**
 * Ajustes que viven en el registro de Windows.
 *
 * Muchos juegos hechos con Unity no guardan sus opciones en archivos, sino en
 * HKCU\Software\<Empresa>\<Juego>. Era un punto ciego: la línea base no los
 * veía y la comparación de configuraciones tampoco.
 *
 * Se leen y se archivan como una configuración más, para que el mismo motor de
 * comparación clave por clave funcione con ellos. Solo lectura: VANTA no
 * escribe en el registro.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PeInfo } from '../../shared/types'

const run = promisify(execFile)

/** Prefijo que marca una configuración que no es un archivo. */
export const REGISTRY_PREFIX = 'registro:'

export const isRegistryConfig = (rel: string): boolean => rel.startsWith(REGISTRY_PREFIX)
export const registryKeyOf = (rel: string): string => rel.slice(REGISTRY_PREFIX.length)

/**
 * Unity usa el nombre de empresa y de producto declarados en el ejecutable,
 * que es justo lo que ya sacamos de sus recursos de versión.
 */
export function unityRegistryKey(pe?: PeInfo): string | null {
  const company = pe?.companyName?.trim()
  const product = pe?.productName?.trim()
  if (!company || !product) return null
  if (/[\\/]/.test(company) || /[\\/]/.test(product)) return null
  return `HKCU\\Software\\${company}\\${product}`
}

/**
 * Vuelca una clave del registro a texto con formato clave=valor, que es lo que
 * el comparador de configuraciones ya sabe leer.
 */
export async function dumpRegistry(key: string): Promise<string | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await run('reg', ['query', key, '/s'], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    })
    const lines: string[] = []
    let section = ''
    for (const raw of stdout.split(/\r?\n/)) {
      const line = raw.trimEnd()
      if (!line.trim()) continue
      if (/^HKEY_/.test(line.trim())) {
        section = line.trim().slice(key.length).replace(/^\\/, '') || '(raíz)'
        lines.push('', `[${section}]`)
        continue
      }
      // Formato de reg.exe: cuatro espacios, nombre, tipo, valor.
      const m = line.match(/^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/)
      if (m) lines.push(`${m[1]}=${m[3]}`)
      else {
        const empty = line.match(/^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)\s*$/)
        if (empty) lines.push(`${empty[1]}=`)
      }
    }
    const text = lines.join('\n').trim()
    return text ? `${text}\n` : null
  } catch {
    return null
  }
}

export async function countValues(key: string): Promise<number> {
  const dump = await dumpRegistry(key)
  if (!dump) return 0
  return dump.split('\n').filter((l) => l.includes('=') && !l.startsWith('[')).length
}
