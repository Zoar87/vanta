import { useEffect, useState } from 'react'
import type { FileReport } from '../../shared/types'
import { bytes, dateTime } from '../store'

interface Props {
  gameId: string
  root: number
  rel: string
  onClose: () => void
}

export default function FileInspector({ gameId, root, rel, onClose }: Props) {
  const [ficha, setFicha] = useState<FileReport | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setFicha(null)
    setError(false)
    window.vanta.inspectFile(gameId, root, rel).then((f) => (f ? setFicha(f) : setError(true)))
  }, [gameId, root, rel])

  const pe = ficha?.pe

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{rel.split('/').pop()}</h2>
          <p className="note" style={{ margin: '6px 0 0', wordBreak: 'break-all' }}>
            {ficha?.abs ?? rel}
          </p>
        </header>

        <div className="scroll" style={{ padding: '14px 20px 18px' }}>
          {error && <p className="note">No se pudo leer el archivo.</p>}
          {!ficha && !error && <p className="note">Leyendo…</p>}

          {ficha && (
            <>
              {!ficha.exists && (
                <div className="warn">
                  Este archivo ya no está en el disco. Lo que ves es lo que quedó anotado de él.
                </div>
              )}

              <dl className="facts">
                <dt>Tamaño</dt>
                <dd className="mono">{bytes(ficha.size)}</dd>

                {ficha.created && (
                  <>
                    <dt>Creado</dt>
                    <dd className="mono">{dateTime(ficha.created)}</dd>
                  </>
                )}
                {ficha.modified && (
                  <>
                    <dt>Modificado</dt>
                    <dd className="mono">{dateTime(ficha.modified)}</dd>
                  </>
                )}

                {ficha.group && (
                  <>
                    <dt>Grupo</dt>
                    <dd>
                      {ficha.group}
                      {ficha.status && <span className="note"> · {ficha.status}</span>}
                    </dd>
                  </>
                )}

                {ficha.sha256 && (
                  <>
                    <dt>Huella SHA-256</dt>
                    <dd className="mono" style={{ wordBreak: 'break-all', fontSize: 11.5 }}>
                      {ficha.sha256}
                    </dd>
                  </>
                )}
                {ficha.baselineSha256 && ficha.baselineSha256 !== ficha.sha256 && (
                  <>
                    <dt>Huella original</dt>
                    <dd className="mono" style={{ wordBreak: 'break-all', fontSize: 11.5 }}>
                      {ficha.baselineSha256}
                    </dd>
                  </>
                )}
              </dl>

              {pe && (
                <>
                  <h4 className="diff-title">Lo que dice el binario</h4>
                  <dl className="facts">
                    <dt>Dice ser</dt>
                    <dd>
                      {[pe.companyName, pe.productName, pe.fileDescription]
                        .filter(Boolean)
                        .join(' · ') || 'no lleva datos de versión'}
                    </dd>
                    {pe.fileVersion && (
                      <>
                        <dt>Versión</dt>
                        <dd className="mono">{pe.fileVersion}</dd>
                      </>
                    )}
                    {pe.originalFilename && (
                      <>
                        <dt>Nombre original</dt>
                        <dd className="mono">{pe.originalFilename}</dd>
                      </>
                    )}
                    <dt>Arquitectura</dt>
                    <dd>
                      {pe.arch}
                      {pe.isDll ? ' · biblioteca' : ' · ejecutable'}
                    </dd>
                    <dt>Firma incrustada</dt>
                    <dd>{pe.hasEmbeddedSignature ? 'sí' : 'no'}</dd>
                    {pe.timestamp && (
                      <>
                        <dt>Compilado el</dt>
                        <dd>{dateTime(pe.timestamp)}</dd>
                      </>
                    )}
                    {pe.imports.length > 0 && (
                      <>
                        <dt>Enlaza con</dt>
                        <dd className="mono" style={{ fontSize: 11.5 }}>
                          {pe.imports.join(', ')}
                        </dd>
                      </>
                    )}
                  </dl>
                  {pe.originalFilename &&
                    pe.originalFilename.toLowerCase() !==
                      (rel.split('/').pop() ?? '').toLowerCase() && (
                      <div className="warn">
                        <strong>Está renombrado.</strong> El binario dice llamarse{' '}
                        {pe.originalFilename}. Es lo normal en un cargador que suplanta a una DLL
                        del sistema, pero conviene saberlo.
                      </div>
                    )}
                </>
              )}

              {ficha.preview && (
                <>
                  <h4 className="diff-title">Primeras líneas</h4>
                  <pre className="preview">{ficha.preview}</pre>
                </>
              )}
            </>
          )}
        </div>

        <footer>
          {ficha?.exists && (
            <button
              className="btn quiet"
              style={{ marginRight: 'auto' }}
              onClick={() => window.vanta.reveal(ficha.abs)}
            >
              Abrir su carpeta
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  )
}
