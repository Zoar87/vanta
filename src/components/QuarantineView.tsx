/**
 * Pestaña de cuarentena: los lotes de archivos purgados de este juego, con la
 * opción de devolverlos a su sitio, abrir el almacén o borrarlos de verdad,
 * que es la única acción destructiva de toda la aplicación.
 */

import { useEffect, useState } from 'react'
import type { Game, QuarantineBatch } from '../../shared/types'
import { CATEGORY } from '../categories'
import { bytes, count, dateTime } from '../store'

interface Props {
  game: Game
  onNotice: (msg: string) => void
  onChanged: () => void
}

export default function QuarantineView({ game, onNotice, onChanged }: Props) {
  const [batches, setBatches] = useState<QuarantineBatch[] | null>(null)
  const [confirming, setConfirming] = useState<QuarantineBatch | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => window.vanta.listQuarantine(game.id).then(setBatches)
  useEffect(() => {
    setBatches(null)
    refresh()
  }, [game.id])

  const restore = async (b: QuarantineBatch) => {
    setBusy(true)
    const res = await window.vanta.restoreQuarantine(b.id)
    setBusy(false)
    refresh()
    onChanged()
    if (res?.ok) {
      const skipped = res.skipped?.length ?? 0
      onNotice(
        `${count(res.restored)} archivos devueltos a su sitio` +
          (skipped ? ` · ${count(skipped)} saltados porque ya había algo ahí` : '')
      )
    } else if (res?.error) {
      onNotice(res.error)
    }
  }

  const destroy = async () => {
    if (!confirming) return
    setBusy(true)
    await window.vanta.destroyQuarantine(confirming.id)
    setBusy(false)
    setConfirming(null)
    refresh()
    onNotice('Lote borrado definitivamente.')
  }

  const active = batches?.filter((b) => !b.restored) ?? []
  const done = batches?.filter((b) => b.restored) ?? []

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        Cada purga crea un lote. Los archivos siguen existiendo, movidos a un almacén en la raíz de
        su misma unidad, con un manifiesto que recuerda de dónde salió cada uno. Borrar de verdad
        es un segundo paso y lo decides tú.
      </p>

      {batches === null ? (
        <p className="note">Cargando…</p>
      ) : batches.length === 0 ? (
        <p className="note">Nada en cuarentena para este juego.</p>
      ) : (
        <>
          {active.map((b) => (
            <article className="batch" key={b.id}>
              <div className="top">
                <span style={{ fontWeight: 600 }}>{b.label}</span>
                <span className="note" style={{ color: CATEGORY[b.category]?.color }}>
                  {CATEGORY[b.category]?.label ?? b.category}
                </span>
                <span className="when">{dateTime(b.createdAt)}</span>
              </div>
              <div className="note" style={{ marginTop: 4 }}>
                {count(b.itemCount)} archivos · {bytes(b.totalBytes)}
              </div>
              <div className="where">{b.storePath}</div>
              <div className="group-actions">
                <button className="btn" onClick={() => restore(b)} disabled={busy}>
                  Devolver al juego
                </button>
                <button className="btn quiet" onClick={() => window.vanta.reveal(b.storePath)}>
                  Abrir el almacén
                </button>
                <button className="btn quiet danger" onClick={() => setConfirming(b)} disabled={busy}>
                  Borrar definitivamente
                </button>
              </div>
            </article>
          ))}

          {done.length > 0 && (
            <>
              <p className="note" style={{ marginTop: 20 }}>
                Lotes ya devueltos
              </p>
              {done.map((b) => (
                <article className="batch" key={b.id} style={{ opacity: 0.55 }}>
                  <div className="top">
                    <span style={{ fontWeight: 600 }}>{b.label}</span>
                    <span className="when">devuelto el {dateTime(b.restored)}</span>
                  </div>
                  <div className="note" style={{ marginTop: 4 }}>
                    {count(b.itemCount)} archivos · {bytes(b.totalBytes)}
                  </div>
                </article>
              ))}
            </>
          )}
        </>
      )}

      {confirming && (
        <div className="overlay" onClick={() => setConfirming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Borrar definitivamente</h2>
            </header>
            <div className="scroll" style={{ padding: '12px 20px' }}>
              <p style={{ margin: 0 }}>
                Se van a eliminar {count(confirming.itemCount)} archivos (
                {bytes(confirming.totalBytes)}) del lote «{confirming.label}». Esto no tiene vuelta
                atrás: después ya no podrás devolverlos al juego.
              </p>
            </div>
            <footer>
              <button className="btn quiet" onClick={() => setConfirming(null)}>
                Cancelar
              </button>
              <button className="btn danger" onClick={destroy} disabled={busy}>
                Borrar los {count(confirming.itemCount)} archivos
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
