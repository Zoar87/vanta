/**
 * Informe exportable.
 *
 * Un resumen en Markdown de cómo está un juego: ficha técnica, línea base, lo
 * que hay puesto encima y qué perfiles existen. Pensado para pegarlo cuando
 * pides ayuda en un foro y te preguntan qué tienes instalado.
 */

import type {
  ChangeReport,
  Conflict,
  Game,
  GameHistory,
  Profile,
  QuarantineBatch
} from '../../shared/types'
import { CATEGORY_LABEL } from './classify'

const API: Record<string, string> = {
  dx9: 'DirectX 9',
  dx10: 'DirectX 10',
  dx11: 'DirectX 11',
  dx12: 'DirectX 12',
  vulkan: 'Vulkan',
  opengl: 'OpenGL'
}

function bytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? 2 : 1)} ${u[i]}`
}

const when = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export interface ExportInput {
  game: Game
  report: ChangeReport | null
  profiles: Profile[]
  batches: QuarantineBatch[]
  history: GameHistory
  conflicts: Conflict[]
}

export function buildMarkdown(input: ExportInput): string {
  const { game, report, profiles, batches, history, conflicts } = input
  const L: string[] = []
  const spec = game.spec

  L.push(`# ${game.name}`, '')
  L.push(`Informe generado por VANTA el ${when(new Date().toISOString())}.`, '')

  L.push('## Ficha técnica', '')
  L.push(`- **Carpeta:** \`${game.path}\``)
  L.push(`- **Plataforma:** ${game.platform}${game.appId ? ` (id ${game.appId})` : ''}${game.buildId ? `, compilación ${game.buildId}` : ''}`)
  if (spec) {
    L.push(`- **Motor:** ${spec.engine}`)
    L.push(
      `- **API gráfica:** ${
        spec.apis.length
          ? spec.apis.map((a) => `${API[a.api] ?? a.api} (confianza ${a.confidence})`).join(', ')
          : 'sin determinar'
      }`
    )
    L.push(`- **Arquitectura:** ${spec.arch}`)
    L.push(`- **Ejecutable:** \`${spec.mainExecutable ?? '—'}\``)
    L.push(
      `- **Anticheat:** ${spec.antiCheat.length ? spec.antiCheat.map((a) => a.name).join(', ') : 'ninguno detectado'}`
    )
    if (spec.proxyDlls.length) {
      L.push('- **DLL que interceptan una API:**')
      for (const d of spec.proxyDlls) {
        L.push(`  - \`${d.file}\` suplanta a ${d.hijacks}${d.identifiedAs ? ` — ${d.identifiedAs}` : ''}`)
      }
    }
  }
  L.push('')

  if (game.baseline) {
    L.push('## Línea base', '')
    L.push(`- Tomada el ${when(game.baseline.takenAt)}`)
    L.push(`- ${game.baseline.fileCount.toLocaleString('es-ES')} archivos, ${bytes(game.baseline.totalBytes)}`)
    for (const r of game.baseline.roots) {
      L.push(`- Raíz: \`${r.path}\` (${r.fileCount.toLocaleString('es-ES')} archivos)`)
    }
    L.push('')
  }

  if (report) {
    const totals = {
      nuevo: report.entries.filter((e) => e.status === 'nuevo').length,
      modificado: report.entries.filter((e) => e.status === 'modificado').length,
      desaparecido: report.entries.filter((e) => e.status === 'desaparecido').length
    }
    L.push(`## Qué hay puesto encima`, '')
    L.push(
      `${report.deep ? 'Verificación profunda' : 'Revisión rápida'} del ${when(report.takenAt)}: ` +
        `${totals.nuevo} archivos nuevos, ${totals.modificado} modificados, ${totals.desaparecido} desaparecidos.`,
      ''
    )
    L.push('| Grupo | Categoría | Archivos | Peso | Detectado por |')
    L.push('| --- | --- | ---: | ---: | --- |')
    for (const g of report.groups) {
      L.push(
        `| ${g.name} | ${CATEGORY_LABEL[g.category]} | ${g.fileCount} | ${bytes(g.totalBytes)} | ${g.detectedBy ?? '—'} |`
      )
    }
    L.push('')
  }

  if (conflicts.length) {
    L.push('## Sobrescrituras de archivos originales', '')
    for (const c of conflicts) {
      L.push(`### ${c.groupName} — ${c.files.length} archivos`, '')
      L.push(`${c.recoverable} de ellos se pueden devolver a su estado original.`, '')
      for (const f of c.files.slice(0, 25)) L.push(`- \`${f}\``)
      if (c.files.length > 25) L.push(`- …y ${c.files.length - 25} más`)
      L.push('')
    }
  }

  if (profiles.length) {
    L.push('## Perfiles', '')
    for (const p of profiles) {
      L.push(
        `- **${p.name}** — ${p.mounted ? 'montado' : 'desmontado'}, ${p.fileCount} archivos, ${bytes(p.totalBytes)}`
      )
    }
    L.push('')
  }

  const active = batches.filter((b) => !b.restored)
  if (active.length) {
    L.push('## En cuarentena', '')
    for (const b of active) {
      L.push(`- **${b.label}** — ${b.itemCount} archivos, ${bytes(b.totalBytes)}, del ${when(b.createdAt)}`)
    }
    L.push('')
  }

  if (history.revisions.length > 1) {
    L.push('## Historial de revisiones', '')
    L.push('| Fecha | Modo | Nuevos | Modificados | Desaparecidos |')
    L.push('| --- | --- | ---: | ---: | ---: |')
    for (const r of history.revisions.slice(-15).reverse()) {
      L.push(
        `| ${when(r.takenAt)} | ${r.deep ? 'profunda' : 'rápida'} | ${r.totals.nuevo} | ${r.totals.modificado} | ${r.totals.desaparecido} |`
      )
    }
    L.push('')
  }

  return L.join('\n')
}

/** Grupos que han sobrescrito archivos originales del juego. */
export function findConflicts(report: ChangeReport | null): Conflict[] {
  if (!report) return []
  const out: Conflict[] = []
  for (const group of report.groups) {
    // Los ajustes los reescribe el propio juego; las partidas cambian al jugar.
    // Ninguno de los dos es un mod pisando originales.
    if (['ausente', 'respaldo', 'configuracion', 'partida'].includes(group.category)) continue
    const overwritten = report.entries.filter(
      (e) => e.groupId === group.id && e.status === 'modificado'
    )
    if (!overwritten.length) continue
    out.push({
      groupId: group.id,
      groupName: group.name,
      category: group.category,
      files: overwritten.map((e) => e.rel),
      recoverable: overwritten.filter((e) => e.hasOriginal).length
    })
  }
  return out.sort((a, b) => b.files.length - a.files.length)
}
