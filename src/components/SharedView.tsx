import { useEffect, useState } from 'react'
import type { SharedFile } from '../../shared/types'
import { bytes, count } from '../store'

/**
 * Lo que tienes puesto en más de un juego.
 *
 * Solo se cruzan los archivos añadidos, nunca los originales: que dos juegos
 * compartan un runtime de Microsoft no dice nada, pero que compartan una DLL
 * de ReShade sí. Y si la huella no coincide, es que en algún sitio te quedó
 * una versión distinta.
 */
export default function SharedView({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<SharedFile[] | null>(null)

  useEffect(() => {
    window.vanta.sharedFiles().then(setFiles)
  }, [])

  const desiguales = files?.filter((f) => f.variants.length) ?? []

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Lo que tienes en varios juegos</h2>
          <p className="note" style={{ margin: '6px 0 0' }}>
            Se comparan por huella los archivos que has añadido tú, no los originales del juego.
          </p>
        </header>

        <div className="scroll" style={{ padding: '14px 20px 18px' }}>
          {!files && <p className="note">Cruzando las revisiones de tus juegos…</p>}

          {files && files.length === 0 && (
            <p className="note">
              Nada repetido. Hace falta haber buscado cambios en al menos dos juegos para que esto
              tenga algo que decir.
            </p>
          )}

          {desiguales.length > 0 && (
            <div className="warn" style={{ borderLeftColor: 'var(--c-loader)' }}>
              <strong>
                {desiguales.length === 1
                  ? 'Hay un archivo con versiones distintas.'
                  : `Hay ${count(desiguales.length)} archivos con versiones distintas.`}
              </strong>{' '}
              Suele significar que en un juego actualizaste algo y en otro te quedó lo viejo.
            </div>
          )}

          {files?.map((f) => (
            <article className="batch" key={f.rel + f.sha256}>
              <div className="top">
                <span className="mono" style={{ fontWeight: 600 }}>
                  {f.rel}
                </span>
                <span className="when">{bytes(f.size)}</span>
              </div>
              <table className="files" style={{ marginTop: 8 }}>
                <tbody>
                  {f.places.map((p) => (
                    <tr key={p.gameId + p.rel}>
                      <td>{p.gameName}</td>
                      <td className="note">{p.group ?? '—'}</td>
                      <td title={p.rel}>{p.rel}</td>
                      <td className="note">misma versión</td>
                    </tr>
                  ))}
                  {f.variants.map((v) => (
                    <tr key={v.gameId + v.rel}>
                      <td>{v.gameName}</td>
                      <td className="note">—</td>
                      <td title={v.rel}>{v.rel}</td>
                      <td style={{ color: 'var(--c-loader)' }}>
                        otra versión · {bytes(v.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
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
