/**
 * Diálogo que lista los juegos encontrados en Steam, Epic y GOG para elegir
 * cuáles añadir a la biblioteca. Los que ya están aparecen marcados y
 * deshabilitados.
 */

import { useEffect, useState } from 'react'
import type { DetectedGame } from '../store'
import { PLATFORM_LABEL, count } from '../store'

interface Props {
  onClose: () => void
  onAdd: (games: DetectedGame[]) => Promise<void>
}

export default function DetectDialog({ onClose, onAdd }: Props) {
  const [found, setFound] = useState<DetectedGame[] | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.vanta.detect().then((r: { games: DetectedGame[]; notes: string[] }) => {
      setFound(r.games)
      setNotes(r.notes)
      setChosen(new Set(r.games.filter((g) => !g.alreadyAdded).map((g) => g.id)))
    })
  }, [])

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const confirm = async () => {
    if (!found) return
    setBusy(true)
    await onAdd(found.filter((g) => chosen.has(g.id)))
    setBusy(false)
    onClose()
  }

  const pending = found?.filter((g) => !g.alreadyAdded) ?? []

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Juegos encontrados</h2>
          <p className="note" style={{ margin: '6px 0 0' }}>
            {found === null
              ? 'Leyendo los inventarios de Steam, Epic y GOG…'
              : `${count(found.length)} instalaciones detectadas, ${count(pending.length)} sin añadir.`}
          </p>
        </header>

        <div className="scroll">
          {found?.map((g) => (
            <label className="pick" key={g.id}>
              <input
                type="checkbox"
                checked={chosen.has(g.id)}
                disabled={g.alreadyAdded}
                onChange={() => toggle(g.id)}
              />
              <div>
                <div className="n">
                  {g.name}{' '}
                  <span className="note">
                    · {PLATFORM_LABEL[g.platform] ?? g.platform}
                    {g.alreadyAdded && ' · ya en la biblioteca'}
                  </span>
                </div>
                <div className="p">{g.path}</div>
              </div>
            </label>
          ))}

          {found?.length === 0 && (
            <p className="note" style={{ padding: 12 }}>
              No he encontrado ninguna instalación. Usa «Añadir carpeta» para señalarla a mano.
            </p>
          )}

          {notes.length > 0 && (
            <ul className="evidence" style={{ padding: '10px 12px 0' }}>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>

        <footer>
          <button className="btn quiet" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={confirm} disabled={busy || chosen.size === 0}>
            Añadir {chosen.size > 0 ? count(chosen.size) : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}
