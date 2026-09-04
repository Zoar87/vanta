/**
 * Panel lateral de estado.
 *
 * Solo aparece en pantallas anchas, donde antes quedaba un hueco vacío a la
 * derecha. Resume de un vistazo lo que hay que saber del juego sin cambiar de
 * pestaña: carátula grande, estado de la línea base, cambios pendientes, qué
 * hay montado, qué hay en cuarentena y la actividad reciente.
 */

import { useEffect, useState } from 'react'
import type { ChangeReport, Game, GameHistory, Profile, QuarantineBatch } from '../../shared/types'
import { artOf } from './Art'
import { bytes, count, dateTime } from '../store'

interface Props {
  game: Game
  report: ChangeReport | null
  busy: boolean
  onScanChanges: () => void
  onGoTo: (tab: 'cambios' | 'perfiles' | 'cuarentena' | 'historial') => void
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : (words[0] ?? '?').slice(0, 2).toUpperCase()
}

export default function SidePanel({ game, report, busy, onScanChanges, onGoTo }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [batches, setBatches] = useState<QuarantineBatch[]>([])
  const [history, setHistory] = useState<GameHistory | null>(null)

  // Se recarga cuando cambia el juego o cuando hay una revisión nueva, que es
  // cuando pueden haber cambiado perfiles, cuarentena o historial.
  useEffect(() => {
    window.vanta.listProfiles(game.id).then(setProfiles)
    window.vanta.listQuarantine(game.id).then(setBatches)
    window.vanta.loadHistory(game.id).then(setHistory)
    return window.vanta.onProfilesChanged((p) => {
      if (!p.length || p[0].gameId === game.id) window.vanta.listProfiles(game.id).then(setProfiles)
    })
  }, [game.id, report?.takenAt, report?.entries.length])

  const art = artOf(game)
  const cover = art.cover ?? art.icon
  const mounted = profiles.filter((p) => p.mounted)
  const active = batches.filter((b) => !b.restored)
  const recent = [
    ...(history?.revisions ?? []).map((r) => ({
      at: r.takenAt,
      text: `${r.deep ? 'Verificación' : 'Revisión'}: ${count(r.totals.nuevo)} nuevos`
    })),
    ...(history?.sessions ?? []).map((s) => ({
      at: s.at,
      text: `Partida ${s.mode}${s.profiles.length ? ` con ${s.profiles.join(', ')}` : ''}`
    }))
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6)

  return (
    <aside className="side">
      {cover ? (
        <img
          className={`cover${art.onlyIcon ? ' icon-only' : ''}`}
          src={cover}
          alt=""
          draggable={false}
        />
      ) : (
        <div className="cover fallback" aria-hidden>
          {initials(game.name)}
        </div>
      )}

      <dl className="facts">
        <dt>Línea base</dt>
        <dd>{game.baseline ? dateTime(game.baseline.takenAt) : 'sin fijar'}</dd>
        <dt>Cambios</dt>
        <dd>
          {report
            ? `${count(report.entries.length)} · ${report.deep ? 'profunda' : 'rápida'}`
            : 'sin revisar'}
        </dd>
        <dt>Montado</dt>
        <dd>{mounted.length ? mounted.map((p) => p.name).join(', ') : 'ningún perfil'}</dd>
        <dt>Cuarentena</dt>
        <dd>
          {active.length
            ? `${count(active.reduce((n, b) => n + b.itemCount, 0))} archivos · ${bytes(
                active.reduce((n, b) => n + b.totalBytes, 0)
              )}`
            : 'vacía'}
        </dd>
      </dl>

      <div className="side-actions">
        {game.baseline && (
          <button className="btn" onClick={onScanChanges} disabled={busy}>
            Buscar cambios
          </button>
        )}
        {profiles.length > 0 && (
          <button className="btn quiet" onClick={() => onGoTo('perfiles')}>
            Perfiles ({count(profiles.length)})
          </button>
        )}
        {active.length > 0 && (
          <button className="btn quiet" onClick={() => onGoTo('cuarentena')}>
            Cuarentena ({count(active.length)} lotes)
          </button>
        )}
      </div>

      {recent.length > 0 && (
        <div className="recent">
          <h4>Actividad reciente</h4>
          <ul>
            {recent.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <time>{dateTime(r.at)}</time>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
