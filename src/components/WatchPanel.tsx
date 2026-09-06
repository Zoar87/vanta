import { useEffect, useState } from 'react'
import type { Game, WatchResult, WatchState } from '../../shared/types'
import { bytes, count, dateTime } from '../store'

/**
 * Vigilante temporal.
 *
 * Responde a «¿quién ha creado esto?». Se toma una foto de la carpeta, haces
 * lo que quieras observar, y al parar te dice exactamente qué apareció durante
 * esa ventana. Sin huellas ni escaneo pesado: solo rutas, tamaños y fechas.
 */
export default function WatchPanel({
  game,
  onInspect
}: {
  game: Game
  onInspect: (f: { root: number; rel: string }) => void
}) {
  const [state, setState] = useState<WatchState | null>(null)
  const [result, setResult] = useState<WatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResult(null)
    setError(null)
    window.vanta.watchState(game.id).then(setState)
  }, [game.id])

  const start = async () => {
    setBusy(true)
    setResult(null)
    setError(null)
    const res = await window.vanta.watchStart(game.id)
    setBusy(false)
    if (res?.ok) setState({ watching: true, startedAt: res.startedAt, fileCount: res.fileCount })
    else setError(res?.error ?? 'No se pudo empezar a vigilar.')
  }

  const stop = async () => {
    setBusy(true)
    const res = await window.vanta.watchStop(game.id)
    setBusy(false)
    setState({ watching: false })
    if (res?.ok) setResult(res.result)
    else setError(res?.error ?? 'No se pudo parar.')
  }

  const aparecidos = result?.changes.filter((c) => c.kind === 'apareció') ?? []
  const otros = result?.changes.filter((c) => c.kind !== 'apareció') ?? []

  return (
    <section className="section">
      <h3>Vigilante</h3>

      {!state?.watching && !result && (
        <p className="note" style={{ marginTop: 0 }}>
          Para pillar in fraganti a lo que crea archivos sin permiso. Empieza a vigilar, haz lo que
          quieras observar (arrancar el juego, pasar un instalador) y vuelve aquí. Te dirá qué
          apareció exactamente en ese rato.
        </p>
      )}

      {state?.watching && (
        <div className="warn" style={{ borderLeftColor: 'var(--c-ok)' }}>
          <strong>Vigilando desde {dateTime(state.startedAt)}.</strong> Anotados{' '}
          {count(state.fileCount ?? 0)} archivos. Ve a hacer lo que quieras observar y vuelve.
        </div>
      )}

      {error && <p className="note">{error}</p>}

      <div className="group-actions" style={{ marginTop: 10 }}>
        {state?.watching ? (
          <button className="btn primary" onClick={stop} disabled={busy}>
            Parar y ver qué ha pasado
          </button>
        ) : (
          <button className="btn" onClick={start} disabled={busy}>
            {busy ? 'Tomando la foto…' : 'Empezar a vigilar'}
          </button>
        )}
      </div>

      {result && (
        <div style={{ marginTop: 16 }}>
          <p className="note" style={{ marginTop: 0 }}>
            {Math.floor(result.seconds / 60)} min {result.seconds % 60} s de vigilancia ·{' '}
            {count(result.changes.length)} cambios
          </p>

          {result.changes.length === 0 ? (
            <p className="note">
              No ha aparecido ni cambiado nada. Si esperabas que sí, prueba a repetirlo dejando la
              vigilancia puesta durante toda la sesión de juego.
            </p>
          ) : (
            <table className="files">
              <thead>
                <tr>
                  <th>Ruta</th>
                  <th>Qué pasó</th>
                  <th className="num">Tamaño</th>
                  <th>Fecha del archivo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...aparecidos, ...otros].slice(0, 300).map((c) => (
                  <tr key={`${c.root}|${c.rel}|${c.kind}`}>
                    <td title={c.rel}>{c.rel}</td>
                    <td>
                      <span className="status" data-s={c.kind === 'apareció' ? 'nuevo' : 'modificado'}>
                        {c.kind}
                      </span>
                    </td>
                    <td className="num">{c.size ? bytes(c.size) : '—'}</td>
                    <td>{c.mtimeMs ? dateTime(new Date(c.mtimeMs).toISOString()) : '—'}</td>
                    <td className="acciones">
                      {c.kind !== 'desapareció' && (
                        <button
                          className="btn quiet"
                          onClick={() => onInspect({ root: c.root, rel: c.rel })}
                        >
                          Ficha
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.changes.length > 300 && (
            <p className="note">Se muestran 300 de {count(result.changes.length)}.</p>
          )}
        </div>
      )}
    </section>
  )
}
