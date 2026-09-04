/**
 * Pestaña de historial: todas las revisiones anotadas con sus grupos, las
 * últimas partidas con qué perfiles tenían montados, y el botón para exportar
 * el informe en Markdown.
 */

import { useEffect, useState } from 'react'
import type { Game, GameHistory } from '../../shared/types'
import { CATEGORY } from '../categories'
import { bytes, count, dateTime, duration } from '../store'

export default function HistoryView({
  game,
  onNotice
}: {
  game: Game
  onNotice: (msg: string) => void
}) {
  const [history, setHistory] = useState<GameHistory | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    setHistory(null)
    window.vanta.loadHistory(game.id).then(setHistory)
  }, [game.id])

  const exportar = async () => {
    const res = await window.vanta.exportReport(game.id)
    if (res?.ok) onNotice(`Informe guardado en ${res.path}`)
    else if (res?.error) onNotice(res.error)
  }

  const revisions = [...(history?.revisions ?? [])].reverse()
  const sessions = [...(history?.sessions ?? [])].reverse().slice(0, 20)

  return (
    <>
      <div className="view-actions" style={{ marginTop: 0 }}>
        <button className="btn" onClick={exportar}>
          Exportar informe
        </button>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        Un resumen en Markdown de la ficha del juego, lo que tienes puesto encima, los perfiles y
        las sobrescrituras. Para pegarlo cuando pidas ayuda en un foro.
      </p>

      <section className="section">
        <h3>Revisiones</h3>
        {history === null ? (
          <p className="note">Cargando…</p>
        ) : revisions.length === 0 ? (
          <p className="note">
            Todavía no has revisado este juego. Cada vez que busques cambios quedará aquí anotado
            qué había y cuándo.
          </p>
        ) : (
          revisions.map((r) => {
            const isOpen = open === r.takenAt
            return (
              <article className="batch" key={r.takenAt}>
                <div className="top">
                  <span style={{ fontWeight: 600 }}>{dateTime(r.takenAt)}</span>
                  <span className="note">{r.deep ? 'verificación profunda' : 'revisión rápida'}</span>
                  <span className="when">{duration(r.durationMs)}</span>
                </div>
                <div className="tallies" style={{ margin: '10px 0 0' }}>
                  <div>
                    <b>{count(r.totals.nuevo)}</b>
                    <span>nuevos</span>
                  </div>
                  <div>
                    <b>{count(r.totals.modificado)}</b>
                    <span>modificados</span>
                  </div>
                  <div>
                    <b>{count(r.totals.desaparecido)}</b>
                    <span>desaparecidos</span>
                  </div>
                </div>
                {r.groups.length > 0 && (
                  <div className="group-actions">
                    <button
                      className="btn quiet"
                      onClick={() => setOpen(isOpen ? null : r.takenAt)}
                    >
                      {isOpen ? 'Ocultar grupos' : `Ver los ${count(r.groups.length)} grupos`}
                    </button>
                  </div>
                )}
                {isOpen && (
                  <table className="files" style={{ marginTop: 10 }}>
                    <tbody>
                      {r.groups.map((g) => (
                        <tr key={g.name}>
                          <td>
                            <span
                              className="dot"
                              style={{ background: CATEGORY[g.category]?.color }}
                            />
                            {g.name}
                          </td>
                          <td className="num">{count(g.fileCount)}</td>
                          <td className="num">{bytes(g.totalBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </article>
            )
          })
        )}
      </section>

      {sessions.length > 0 && (
        <section className="section">
          <h3>Últimas partidas</h3>
          <table className="files">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Modo</th>
                <th>Con qué montado</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={`${s.at}-${i}`}>
                  <td>{dateTime(s.at)}</td>
                  <td>{s.mode}</td>
                  <td>{s.profiles.length ? s.profiles.join(', ') : 'nada'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
