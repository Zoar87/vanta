/**
 * Barra de progreso de un escaneo o una revisión. Mientras corre enseña los
 * archivos procesados y el actual; al acabar, el resumen que mande el proceso
 * principal.
 */

import type { ScanProgress } from '../../shared/types'
import { bytes, count } from '../store'

const LABEL: Record<string, string> = {
  recorriendo: 'Recorriendo carpetas',
  calculando: 'Calculando huellas',
  analizando: 'Identificando archivos',
  guardando: 'Guardando',
  hecho: 'Hecho',
  cancelado: 'Cancelado',
  error: 'Falló'
}

export default function Progress({ p }: { p: ScanProgress }) {
  const done = ['hecho', 'cancelado', 'error'].includes(p.phase)
  const pct = p.totalBytes > 0 ? Math.min(100, (p.bytesHashed / p.totalBytes) * 100) : 0

  return (
    <div className="progress">
      <div className="line">
        <span>{LABEL[p.phase] ?? p.phase}</span>
        <span>
          {done
            ? `${count(p.filesSeen)} archivos`
            : `${count(p.filesHashed)} de ${count(p.filesSeen)} archivos`}
          {p.bytesHashed > 0 && ` · ${bytes(p.bytesHashed)}`}
        </span>
      </div>
      <div className="track">
        <div
          className={`fill${!done && pct === 0 ? ' indeterminate' : ''}`}
          style={{ width: done ? '100%' : `${Math.max(pct, 2)}%` }}
        />
      </div>
      <div className="line">
        <span className="cur">{p.message ?? p.currentPath}</span>
      </div>
    </div>
  )
}
