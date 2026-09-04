/**
 * Línea de tiempo.
 *
 * Instalar un mod deja decenas de archivos con la misma fecha, con segundos de
 * diferencia entre ellos. Agrupándolos por el momento en que aparecieron, una
 * lista de cien archivos sueltos se convierte en tres acciones: «a las 23:21
 * pusiste esto, a las 23:24 esto otro».
 *
 * Es la forma más directa de responder a «¿y esto de dónde ha salido?», porque
 * lo que apareció junto casi siempre vino junto.
 */

import type { ChangeEntry, FileGroup, TimeCluster } from '../../shared/types'

/** Hueco a partir del cual se considera que empieza otra acción distinta. */
const CORTE_MS = 4 * 60 * 1000

export function clusterByTime(entries: ChangeEntry[], groups: FileGroup[]): TimeCluster[] {
  const nombre = new Map(groups.map((g) => [g.id, g.name]))

  const conFecha = entries
    .filter((e) => e.status !== 'desaparecido' && e.mtimeMs > 0)
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
  if (!conFecha.length) return []

  const lotes: ChangeEntry[][] = [[conFecha[0]]]
  for (let i = 1; i < conFecha.length; i++) {
    const actual = lotes[lotes.length - 1]
    const hueco = conFecha[i].mtimeMs - actual[actual.length - 1].mtimeMs
    if (hueco > CORTE_MS) lotes.push([conFecha[i]])
    else actual.push(conFecha[i])
  }

  return lotes
    .map((lote) => {
      const desde = lote[0].mtimeMs
      const hasta = lote[lote.length - 1].mtimeMs
      // Los nombres de grupo, ordenados por cuántos archivos aporta cada uno.
      const cuenta = new Map<string, number>()
      for (const e of lote) {
        const g = nombre.get(e.groupId) ?? 'sin identificar'
        cuenta.set(g, (cuenta.get(g) ?? 0) + 1)
      }
      return {
        at: new Date(desde).toISOString(),
        fileCount: lote.length,
        totalBytes: lote.reduce((n, e) => n + e.size, 0),
        groups: [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g),
        sample: lote
          .slice()
          .sort((a, b) => b.size - a.size)
          .slice(0, 5)
          .map((e) => e.rel),
        spanMinutes: Math.round((hasta - desde) / 60000)
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
}
