/**
 * Ventana de comparación de un archivo de configuración clave por clave,
 * contra la versión de fábrica o cualquiera de las guardadas. Permite marcar
 * claves y revertirlas de forma quirúrgica cuando el formato lo admite.
 */

import { useEffect, useState } from 'react'
import type { ConfigDiff, ConfigVersion } from '../../shared/types'
import { count, dateTime } from '../store'

interface Props {
  gameId: string
  root: number
  rel: string
  onClose: () => void
  onNotice: (msg: string) => void
  onReverted: () => void
}

export default function ConfigDiffView({ gameId, root, rel, onClose, onNotice, onReverted }: Props) {
  const [diff, setDiff] = useState<ConfigDiff | null>(null)
  const [versions, setVersions] = useState<ConfigVersion[]>([])
  const [against, setAgainst] = useState<ConfigVersion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = async (file: string | null) => {
    setDiff(null)
    setError(null)
    const res = await window.vanta.configDiff(gameId, root, rel, file)
    if (res?.ok) {
      setDiff(res.diff)
      setVersions(res.versions)
      setAgainst(res.against)
      setPicked(new Set())
    } else {
      setError(res?.error ?? 'No se pudo comparar.')
    }
  }

  useEffect(() => {
    load(null)
  }, [gameId, root, rel])

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const revert = async () => {
    if (!diff || !picked.size) return
    const keys = diff.changed
      .filter((c) => picked.has(c.key))
      .map((c) => ({ key: c.key, value: c.from }))
    setBusy(true)
    const res = await window.vanta.configRevert(gameId, root, rel, keys)
    setBusy(false)
    if (res?.ok) {
      onNotice(`${count(res.applied.length)} claves devueltas a su valor anterior.`)
      onReverted()
      load(against?.file ?? null)
    } else if (res?.error) {
      onNotice(res.error)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{rel.split('/').pop()}</h2>
          <p className="note" style={{ margin: '6px 0 0' }}>
            {rel}
          </p>
          {versions.length > 1 && (
            <label className="field" style={{ margin: '12px 0 0' }}>
              <span>Comparar contra</span>
              <select
                value={against?.file ?? ''}
                onChange={(e) => load(e.target.value || null)}
              >
                {versions.map((v) => (
                  <option key={v.file} value={v.file}>
                    {v.factory ? 'Versión de fábrica' : `Guardada el ${dateTime(v.at)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        <div className="scroll" style={{ padding: '12px 20px 16px' }}>
          {error && <p className="note">{error}</p>}
          {!diff && !error && <p className="note">Comparando…</p>}

          {diff && (
            <>
              <p className="note" style={{ marginTop: 0 }}>
                {count(diff.changed.length)} claves cambiadas, {count(diff.added.length)} nuevas,{' '}
                {count(diff.removed.length)} desaparecidas, {count(diff.unchanged)} iguales.
              </p>

              {!diff.surgical && (
                <div className="warn">
                  Este formato no permite revertir claves sueltas conservando el archivo tal cual.
                  Puedes ver qué cambió, pero para deshacerlo hay que restaurar el archivo entero.
                </div>
              )}

              {diff.changed.length > 0 && (
                <>
                  <h4 className="diff-title">Cambiadas</h4>
                  <table className="files diff">
                    <tbody>
                      {diff.changed.map((c) => (
                        <tr key={c.key}>
                          <td className="pick-cell">
                            {diff.surgical && (
                              <input
                                type="checkbox"
                                checked={picked.has(c.key)}
                                onChange={() => toggle(c.key)}
                                aria-label={`Revertir ${c.key}`}
                              />
                            )}
                          </td>
                          <td title={c.key}>{c.key}</td>
                          <td className="was">{c.from || '(vacío)'}</td>
                          <td className="arrow">→</td>
                          <td className="is">{c.to || '(vacío)'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {diff.added.length > 0 && (
                <>
                  <h4 className="diff-title">Añadidas</h4>
                  <table className="files diff">
                    <tbody>
                      {diff.added.map((a) => (
                        <tr key={a.key}>
                          <td className="pick-cell" />
                          <td title={a.key}>{a.key}</td>
                          <td colSpan={3} className="is">
                            {a.value || '(vacío)'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {diff.removed.length > 0 && (
                <>
                  <h4 className="diff-title">Desaparecidas</h4>
                  <table className="files diff">
                    <tbody>
                      {diff.removed.map((r) => (
                        <tr key={r.key}>
                          <td className="pick-cell" />
                          <td title={r.key}>{r.key}</td>
                          <td colSpan={3} className="was">
                            {r.value || '(vacío)'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {!diff.changed.length && !diff.added.length && !diff.removed.length && (
                <p className="note">
                  Ni una diferencia. El archivo se reescribió, pero con los mismos valores.
                </p>
              )}
            </>
          )}
        </div>

        <footer>
          <span className="note" style={{ marginRight: 'auto' }}>
            {picked.size > 0 && `${count(picked.size)} seleccionadas`}
          </span>
          <button className="btn quiet" onClick={onClose}>
            Cerrar
          </button>
          <button className="btn primary" onClick={revert} disabled={busy || picked.size === 0}>
            Revertir las seleccionadas
          </button>
        </footer>
      </div>
    </div>
  )
}
