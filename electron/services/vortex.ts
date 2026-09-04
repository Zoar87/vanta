/**
 * Lectura del manifiesto de despliegue de Vortex.
 *
 * Vortex escribe un `vortex.deployment.json` en la carpeta donde despliega, y
 * ahí consta cada archivo que ha puesto y de qué mod salió. Es la fuente más
 * fiable posible: no hay que adivinar nada, lo dice el propio gestor.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Sitios donde Vortex suele desplegar, además de la raíz. */
const LIKELY = ['', 'Data', 'DATA', 'Binaries', 'mods', 'Content']

export interface Deployment {
  /** Ruta relativa en minúsculas -> nombre del mod que la puso. */
  files: Map<string, string>
  manifests: string[]
}

function parse(json: string, prefix: string, into: Map<string, string>): number {
  let added = 0
  try {
    const data = JSON.parse(json)
    for (const f of data?.files ?? []) {
      const rel = typeof f?.relPath === 'string' ? f.relPath : null
      if (!rel) continue
      const source = typeof f?.source === 'string' ? f.source : 'mod sin nombre'
      // El nombre del archivo del mod suele traer sufijos de Nexus: se recortan.
      const clean = source
        .replace(/\.(zip|7z|rar|installing)$/i, '')
        .replace(/-\d+-[\d-]+$/, '')
        .trim()
      const full = (prefix ? `${prefix}/${rel}` : rel).replace(/\\/g, '/').toLowerCase()
      into.set(full, clean || 'mod sin nombre')
      added++
    }
  } catch {
    /* manifiesto ilegible */
  }
  return added
}

export async function readDeployments(roots: string[]): Promise<Deployment> {
  const files = new Map<string, string>()
  const manifests: string[] = []
  // Windows no distingue mayúsculas: Data y DATA son la misma carpeta y el
  // manifiesto solo debe leerse una vez.
  const seen = new Set<string>()

  for (const root of roots) {
    for (const sub of LIKELY) {
      const dir = sub ? path.join(root, sub) : root
      const manifest = path.join(dir, 'vortex.deployment.json')
      const key = manifest.toLowerCase()
      if (seen.has(key) || !existsSync(manifest)) continue
      seen.add(key)
      try {
        const added = parse(await readFile(manifest, 'utf8'), sub.replace(/\\/g, '/'), files)
        if (added) manifests.push(manifest)
      } catch {
        /* sin permisos */
      }
    }
  }
  return { files, manifests }
}
