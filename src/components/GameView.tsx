/**
 * Vista de un juego.
 *
 * Contenedor de todo lo que se ve al seleccionar un juego: cabecera con el
 * arte, acciones principales, barra de progreso, pestañas y, en pantallas
 * anchas, el panel lateral de estado. Los datos pesados (informe de cambios)
 * se cargan aquí una vez y se pasan a las pestañas que los necesitan.
 */

import { useEffect, useState } from 'react'
import type { ChangeReport, Game } from '../../shared/types'
import { useStore, count } from '../store'
import Art, { artUrl, logoUrl } from './Art'
import Progress from './Progress'
import Summary from './Summary'
import ChangesView from './ChangesView'
import QuarantineView from './QuarantineView'
import ProfilesView from './ProfilesView'
import HistoryView from './HistoryView'
import SidePanel from './SidePanel'

type Tab = 'resumen' | 'cambios' | 'perfiles' | 'cuarentena' | 'historial'

interface RemovePreview {
  profiles: number
  unmounted: number
  unmountedFiles: number
  batches: number
  batchFiles: number
}

interface BaselinePreview {
  mounted: { id: string; name: string }[]
  unmounted: { id: string; name: string }[]
}

export default function GameView({ game }: { game: Game }) {
  const { scans, setGames, setError } = useStore()
  const progress = scans[game.id]
  const scanning = progress && !['hecho', 'cancelado', 'error'].includes(progress.phase)

  const [tab, setTab] = useState<Tab>('resumen')
  const [report, setReport] = useState<ChangeReport | null>(null)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [removing, setRemoving] = useState<RemovePreview | null>(null)
  const [alsoQuarantine, setAlsoQuarantine] = useState(true)
  const [baselineAsk, setBaselineAsk] = useState<BaselinePreview | null>(null)
  const busy = !!scanning || working

  // Al cambiar de juego se vuelve al resumen y se recarga su última revisión.
  useEffect(() => {
    setTab('resumen')
    setNotice(null)
    setReport(null)
    window.vanta.loadChanges(game.id).then(setReport)
  }, [game.id])

  const reloadReport = async () => setReport(await window.vanta.loadChanges(game.id))

  /** Fija la línea base. Si hay perfiles montados, primero pregunta. */
  const askBaseline = async () => {
    const preview = await window.vanta.baselinePreview(game.id)
    if (preview.mounted.length) setBaselineAsk(preview)
    else runBaseline()
  }

  const runBaseline = async (unmountFirst: string[] = []) => {
    setBaselineAsk(null)
    setError(null)
    setNotice(null)
    setWorking(true)
    for (const id of unmountFirst) await window.vanta.setProfileMounted(id, false)
    const res = await window.vanta.startScan(game.id)
    setWorking(false)
    if (!res?.ok && res?.error) setError(res.error)
    else if (res?.ok) {
      const parts = ['Línea base fijada.']
      if (res.originals) parts.push(`Copia de ${count(res.originals.fileCount)} originales pequeños guardada.`)
      if (res.summary?.unreadable) parts.push(`${count(res.summary.unreadable)} archivos no se pudieron leer.`)
      setNotice(parts.join(' '))
    }
    setGames(await window.vanta.listGames())
    await reloadReport()
  }

  const scanChanges = async () => {
    setWorking(true)
    const res = await window.vanta.scanChanges(game.id, false)
    setWorking(false)
    if (res?.ok) setReport(res.report)
    else if (res?.error) setNotice(res.error)
    setTab('cambios')
  }

  const pending = report?.entries.length ?? 0
  const hero = artUrl(game.art?.hero) ?? artUrl(game.art?.cover)
  const logo = logoUrl(game)

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'cambios', label: 'Cambios', badge: pending },
    { id: 'perfiles', label: 'Perfiles' },
    { id: 'cuarentena', label: 'Cuarentena' },
    { id: 'historial', label: 'Historial' }
  ]

  return (
    <div className="view">
      <div className="main-col">
        <div className="view-head">
          {hero && <div className="hero" style={{ backgroundImage: `url("${hero}")` }} />}
          <Art game={game} size="head" />
          <div className="titles">
            {logo ? (
              <>
                <img className="logo" src={logo} alt={game.name} draggable={false} />
                <h1 className="visually-hidden">{game.name}</h1>
              </>
            ) : (
              <h1>{game.name}</h1>
            )}
            <div className="path" onClick={() => window.vanta.reveal(game.path)} title="Abrir en el explorador">
              {game.path}
            </div>
          </div>
        </div>

        <div className="view-actions">
          {scanning ? (
            <button className="btn danger" onClick={() => window.vanta.cancelScan(game.id)}>
              Cancelar
            </button>
          ) : (
            <button className="btn primary" onClick={askBaseline} disabled={busy}>
              {game.baseline ? 'Rehacer línea base' : 'Escanear y fijar línea base'}
            </button>
          )}
          {game.platform === 'steam' && (
            <button
              className="btn quiet"
              onClick={() => window.vanta.validateOnSteam(game.id)}
              disabled={busy}
              title="Abre la verificación de integridad de Steam para este juego"
            >
              Verificar en Steam
            </button>
          )}
          <button
            className="btn quiet danger"
            onClick={async () => setRemoving(await window.vanta.removePreview(game.id))}
            disabled={busy}
          >
            Quitar de la biblioteca
          </button>
        </div>

        {progress && <Progress p={progress} />}

        {notice && (
          <div className="warn" style={{ borderLeftColor: 'var(--c-ok)' }}>
            {notice}{' '}
            <button className="btn quiet" onClick={() => setNotice(null)} style={{ marginLeft: 8 }}>
              Cerrar
            </button>
          </div>
        )}

        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              className="tab"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.badge ? <span className="badge">{count(t.badge)}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'resumen' && <Summary game={game} busy={busy} onBusy={setWorking} onNotice={setNotice} />}
        {tab === 'cambios' && (
          <ChangesView
            game={game}
            busy={busy}
            report={report}
            onReport={setReport}
            onBusy={setWorking}
            onNotice={setNotice}
          />
        )}
        {tab === 'perfiles' && (
          <ProfilesView game={game} busy={busy} onBusy={setWorking} onNotice={setNotice} onChanged={reloadReport} />
        )}
        {tab === 'cuarentena' && <QuarantineView game={game} onNotice={setNotice} onChanged={reloadReport} />}
        {tab === 'historial' && <HistoryView game={game} onNotice={setNotice} />}
      </div>

      <div className="side-col">
        <SidePanel game={game} report={report} busy={busy} onScanChanges={scanChanges} onGoTo={setTab} />
      </div>

      {baselineAsk && (
        <div className="overlay" onClick={() => setBaselineAsk(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Tienes perfiles montados</h2>
            </header>
            <div className="scroll" style={{ padding: '12px 20px' }}>
              <p style={{ marginTop: 0 }}>
                {baselineAsk.mounted.map((p) => p.name).join(', ')}{' '}
                {baselineAsk.mounted.length === 1 ? 'está montado' : 'están montados'}. Si rehaces
                la línea base ahora, sus archivos pasarán a contar como originales del juego y VANTA
                dejará de verlos como algo añadido.
              </p>
              <p>Lo normal es desmontarlos antes, fijar la línea base con el juego limpio y volver a montarlos.</p>
            </div>
            <footer>
              <button className="btn quiet" onClick={() => setBaselineAsk(null)}>
                Cancelar
              </button>
              <button className="btn quiet" onClick={() => runBaseline()}>
                Continuar así
              </button>
              <button className="btn primary" onClick={() => runBaseline(baselineAsk.mounted.map((p) => p.id))}>
                Desmontar y continuar
              </button>
            </footer>
          </div>
        </div>
      )}

      {removing && (
        <div className="overlay" onClick={() => setRemoving(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Quitar «{game.name}»</h2>
            </header>
            <div className="scroll" style={{ padding: '12px 20px' }}>
              <p style={{ marginTop: 0 }}>
                Se olvida el juego, su línea base y su historial. La carpeta del juego no se toca.
              </p>
              {removing.unmounted > 0 && (
                <p>
                  Antes, los {count(removing.unmountedFiles)} archivos de {count(removing.unmounted)}{' '}
                  perfiles desmontados vuelven a la carpeta del juego. VANTA no se queda con nada tuyo.
                </p>
              )}
              {removing.batches > 0 && (
                <label className="field inline">
                  <input type="checkbox" checked={alsoQuarantine} onChange={(e) => setAlsoQuarantine(e.target.checked)} />
                  Devolver también los {count(removing.batchFiles)} archivos que tienes en cuarentena
                </label>
              )}
            </div>
            <footer>
              <button className="btn quiet" onClick={() => setRemoving(null)}>
                Cancelar
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  setRemoving(null)
                  const res = await window.vanta.removeGame(game.id, { restoreQuarantine: alsoQuarantine })
                  if (res?.games) setGames(res.games)
                }}
              >
                Quitar de la biblioteca
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
