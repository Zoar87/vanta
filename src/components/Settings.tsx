/**
 * Ventana de ajustes: dónde guarda VANTA sus datos, cuánto ocupa cada parte y
 * las reglas que ha aprendido del usuario, con la opción de olvidarlas.
 */

import { useEffect, useState } from 'react'
import type { LearnedRule } from '../../shared/types'
import { CATEGORY } from '../categories'
import { bytes, count } from '../store'

const LABEL: Record<string, string> = {
  baselines: 'Líneas base',
  reports: 'Última revisión',
  history: 'Historial',
  originals: 'Copias de originales',
  configs: 'Versiones de configuración',
  art: 'Carátulas',
  cuarentena: 'Cuarentena',
  perfiles: 'Perfiles desmontados'
}

interface Usage {
  dataDir: string
  usage: Record<string, { files: number; bytes: number }>
}

type UpdateState =
  | { phase: 'inactivo'; reason?: string }
  | { phase: 'buscando' }
  | { phase: 'al-dia'; version: string }
  | { phase: 'disponible'; version: string; notes?: string }
  | { phase: 'descargando'; percent: number; version: string }
  | { phase: 'lista'; version: string }
  | { phase: 'error'; message: string }

function UpdateBox() {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    window.vanta.updateState().then((s: UpdateState) => setState(s))
    return window.vanta.onUpdateState((s) => setState(s as UpdateState))
  }, [])

  const text = (): string => {
    if (!state) return '…'
    switch (state.phase) {
      case 'inactivo':
        return state.reason ?? 'Todavía no se ha buscado.'
      case 'buscando':
        return 'Consultando las versiones publicadas…'
      case 'al-dia':
        return `Tienes la última versión (${state.version}).`
      case 'disponible':
        return `Hay una versión nueva, la ${state.version}. Descargando…`
      case 'descargando':
        return `Descargando la ${state.version}: ${state.percent}%`
      case 'lista':
        return `La ${state.version} está descargada. Reinicia VANTA para instalarla.`
      case 'error':
        return `No se pudo comprobar: ${state.message}`
    }
  }

  return (
    <>
      <h4 className="diff-title">Actualizaciones</h4>
      <p className="note" style={{ margin: '0 0 8px' }}>
        {text()}
      </p>
      <div className="group-actions" style={{ marginTop: 0 }}>
        <button
          className="btn"
          onClick={() => window.vanta.checkUpdates()}
          disabled={state?.phase === 'buscando' || state?.phase === 'descargando'}
        >
          Buscar actualizaciones
        </button>
        {state?.phase === 'lista' && (
          <button className="btn primary" onClick={() => window.vanta.installUpdate()}>
            Reiniciar e instalar
          </button>
        )}
      </div>
    </>
  )
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<Usage | null>(null)
  const [rules, setRules] = useState<LearnedRule[] | null>(null)

  useEffect(() => {
    window.vanta.usage().then(setInfo)
    window.vanta.listRules().then(setRules)
  }, [])

  const forget = async (id: string) => {
    setRules(await window.vanta.removeRule(id))
  }

  const total = info
    ? Object.values(info.usage).reduce((n, u) => n + u.bytes, 0)
    : 0

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Ajustes</h2>
        </header>

        <div className="scroll" style={{ padding: '14px 20px 18px' }}>
          <h4 className="diff-title" style={{ marginTop: 0 }}>
            Dónde guarda VANTA sus cosas
          </h4>
          <p className="mono" style={{ fontSize: 12, color: 'var(--dim)', wordBreak: 'break-all' }}>
            {info?.dataDir ?? '…'}
          </p>
          <button className="btn" onClick={() => window.vanta.openDataDir()}>
            Abrir la carpeta
          </button>

          <h4 className="diff-title">Espacio ocupado · {bytes(total)} en total</h4>
          {!info ? (
            <p className="note">Calculando…</p>
          ) : (
            <table className="files">
              <tbody>
                {Object.entries(info.usage)
                  .sort((a, b) => b[1].bytes - a[1].bytes)
                  .map(([key, u]) => (
                    <tr key={key}>
                      <td>{LABEL[key] ?? key}</td>
                      <td className="num">{count(u.files)} archivos</td>
                      <td className="num">{bytes(u.bytes)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          <p className="note" style={{ marginTop: 8 }}>
            La cuarentena y los perfiles desmontados viven en la raíz de cada unidad, no aquí, para
            que mover archivos sea instantáneo.
          </p>

          <UpdateBox />

          <h4 className="diff-title">Lo que le has enseñado</h4>
          {rules === null ? (
            <p className="note">Cargando…</p>
          ) : rules.length === 0 ? (
            <p className="note">
              Nada todavía. Cuando nombres un grupo desconocido y marques «recordarlo», la regla
              aparecerá aquí y podrás quitarla si te equivocaste.
            </p>
          ) : (
            <table className="files">
              <thead>
                <tr>
                  <th>Se llama</th>
                  <th>Se aplica a</th>
                  <th>Categoría</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td title={r.pattern}>
                      {r.pattern.endsWith('/') ? `todo lo que haya en ${r.pattern}` : r.pattern}
                    </td>
                    <td>
                      <span className="dot" style={{ background: CATEGORY[r.category]?.color }} />
                      {CATEGORY[r.category]?.label ?? r.category}
                    </td>
                    <td>
                      <button className="btn quiet danger" onClick={() => forget(r.id)}>
                        Olvidar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer>
          <button className="btn primary" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  )
}
