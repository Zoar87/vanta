/**
 * Panel lateral izquierdo con la biblioteca de juegos, al estilo de Steam:
 * carátula, nombre, plataforma y un filete de color que indica si el juego
 * tiene línea base. Desde aquí se buscan los juegos instalados y se añaden
 * carpetas a mano.
 */

import { useMemo } from 'react'
import { useStore, PLATFORM_LABEL, count } from '../store'
import Art from './Art'

interface Props {
  onDetect: () => void
  onAddFolder: () => void
}

export default function Library({ onDetect, onAddFolder }: Props) {
  const { games, selectedId, filter, setFilter, select } = useStore()

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return games
    return games.filter((g) => g.name.toLowerCase().includes(q) || g.path.toLowerCase().includes(q))
  }, [games, filter])

  return (
    <aside className="rail">
      <div className="rail-head">
        <h2>Biblioteca</h2>
        <span>{count(games.length)}</span>
      </div>

      <input
        className="rail-search"
        placeholder="Filtrar"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filtrar juegos"
      />

      <div className="rail-list">
        {visible.map((g) => (
          <button
            key={g.id}
            className="game-item"
            data-state={g.baseline ? 'base' : 'none'}
            aria-current={g.id === selectedId}
            onClick={() => select(g.id)}
          >
            <span className="stripe" />
            <Art game={g} size="rail" />
            <span className="body">
              <span className="name">{g.name}</span>
              <span className="sub">
                {PLATFORM_LABEL[g.platform] ?? g.platform}
                {g.baseline ? ` · ${count(g.baseline.fileCount)} archivos` : ' · sin línea base'}
              </span>
            </span>
          </button>
        ))}

        {!visible.length && (
          <p className="note" style={{ padding: '14px 14px 0' }}>
            {games.length ? 'Nada coincide con el filtro.' : 'Todavía no has añadido ningún juego.'}
          </p>
        )}
      </div>

      <div className="rail-foot">
        <button className="btn" onClick={onDetect}>
          Buscar instalados
        </button>
        <button className="btn quiet" onClick={onAddFolder}>
          Añadir carpeta
        </button>
      </div>
    </aside>
  )
}
