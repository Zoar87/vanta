/**
 * Componente raíz: armazón de tres zonas (barra superior, biblioteca a la
 * izquierda y vista del juego en el centro), suscripción a los eventos del
 * proceso principal y los diálogos globales de detección y ajustes.
 */

import { useEffect, useState } from 'react'
import Library from './components/Library'
import GameView from './components/GameView'
import DetectDialog from './components/DetectDialog'
import Settings from './components/Settings'
import { useStore, type DetectedGame } from './store'

interface AppInfo {
  version: string
  electron: string
  node: string
  dataDir: string
}

export default function App() {
  const { games, selectedId, ready, load, setGames, setProgress, lastError, setError } = useStore()
  const [detecting, setDetecting] = useState(false)
  const [settings, setSettings] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    load()
    window.vanta.info().then(setInfo)
    const offProgress = window.vanta.onScanProgress(setProgress)
    const offLibrary = window.vanta.onLibraryChanged(setGames)
    return () => {
      offProgress()
      offLibrary()
    }
  }, [])

  const addFolder = async () => {
    const picked = await window.vanta.pickFolder()
    if (!picked) return
    setGames(await window.vanta.addGames([{ path: picked.path, name: picked.name, platform: 'manual' }]))
  }

  const addDetected = async (chosen: DetectedGame[]) => {
    setGames(await window.vanta.addGames(chosen))
  }

  const selected = games.find((g) => g.id === selectedId) ?? null

  return (
    <div className="shell">
      <header className="bar">
        <span className="wordmark">VANTA</span>
        <span className="meta">integridad de carpetas de juego</span>
        <span className="spacer" />
        {info && (
          <span className="meta" title={info.dataDir}>
            v{info.version} · Electron {info.electron}
          </span>
        )}
        <button className="btn quiet" onClick={() => setSettings(true)} title="Ajustes">
          Ajustes
        </button>
      </header>

      <Library onDetect={() => setDetecting(true)} onAddFolder={addFolder} />

      <main className="main">
        {lastError && (
          <div className="warn" style={{ margin: '18px 28px 0' }}>
            <strong>No se pudo completar.</strong> {lastError}{' '}
            <button className="btn quiet" onClick={() => setError(null)} style={{ marginLeft: 8 }}>
              Cerrar
            </button>
          </div>
        )}

        {selected ? (
          <GameView game={selected} key={selected.id} />
        ) : (
          <div className="empty">
            <h2>{ready ? 'Elige un juego' : 'Cargando biblioteca'}</h2>
            <p>
              Busca los que ya tienes instalados o señala una carpeta a mano. Después, fija su línea
              base para que VANTA sepa cómo era el juego antes de que lo tocaras.
            </p>
            <div>
              <button className="btn primary" onClick={() => setDetecting(true)}>
                Buscar juegos instalados
              </button>
            </div>
          </div>
        )}
      </main>

      {settings && <Settings onClose={() => setSettings(false)} />}
      {detecting && <DetectDialog onClose={() => setDetecting(false)} onAdd={addDetected} />}
    </div>
  )
}
