import { useEffect, useState } from 'react'
import type { FileRecord, Game, GraphicsApi, LinkedPath, OriginalsSummary } from '../../shared/types'
import { useStore, bytes, count, dateTime, duration, API_LABEL, PLATFORM_LABEL } from '../store'
import ConfigDiffView from './ConfigDiffView'

const KIND_LABEL: Record<LinkedPath['kind'], string> = {
  documentos: 'Documentos',
  'appdata-local': 'AppData Local',
  'appdata-roaming': 'AppData Roaming',
  gestor: 'Gestor de mods',
  otra: 'Otra'
}

/**
 * Pestaña de resumen: ficha técnica, DLL proxy, carpetas externas vigiladas y
 * datos de la línea base. Todo lo que hay aquí es lectura, salvo vincular
 * carpetas externas y volver a analizar la ficha.
 */
export default function Summary({
  game,
  busy,
  onBusy,
  onNotice
}: {
  game: Game
  busy: boolean
  onBusy: (b: boolean) => void
  onNotice: (msg: string) => void
}) {
  const { setGames } = useStore()
  const [sample, setSample] = useState<FileRecord[] | null>(null)
  const [suggestions, setSuggestions] = useState<LinkedPath[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [originals, setOriginals] = useState<OriginalsSummary | null>(null)
  const [artBusy, setArtBusy] = useState(false)
  const [registry, setRegistry] = useState<{ root: number; rel: string } | null>(null)

  useEffect(() => {
    setNota(game.note ?? '')
    setNotaGuardada(false)
  }, [game.id])

  const guardarNota = async () => {
    await window.vanta.setNote(game.id, nota)
    setGames(await window.vanta.listGames())
    setNotaGuardada(true)
    setTimeout(() => setNotaGuardada(false), 2500)
  }

  useEffect(() => {
    setSample(null)
    setSuggestions(null)
    setOriginals(null)
    if (!game.baseline) return
    window.vanta.peekBaseline(game.id, 120).then((r) => setSample(r?.sample ?? []))
    window.vanta.measureOriginals(game.id).then(setOriginals)
  }, [game.id, game.baseline?.takenAt])

  const findLinks = async () => {
    setSearching(true)
    setSuggestions(await window.vanta.suggestLinks(game.id))
    setSearching(false)
  }

  const addLink = async (link: LinkedPath) => {
    await window.vanta.updateGame(game.id, { linkedPaths: [...game.linkedPaths, link] })
    setGames(await window.vanta.listGames())
    setSuggestions((s) => s?.filter((x) => x.path !== link.path) ?? null)
  }

  const removeLink = async (p: string) => {
    await window.vanta.updateGame(game.id, {
      linkedPaths: game.linkedPaths.filter((l) => l.path !== p)
    })
    setGames(await window.vanta.listGames())
  }

  const toggleProtect = async (p: string) => {
    await window.vanta.updateGame(game.id, {
      linkedPaths: game.linkedPaths.map((l) =>
        l.path === p ? { ...l, protected: !l.protected } : l
      )
    })
    setGames(await window.vanta.listGames())
  }

  /** Rehace motor, API, anticheat y DLL proxy sin volver a leer el juego entero. */
  const reanalyze = async () => {
    onBusy(true)
    const res = await window.vanta.reanalyze(game.id)
    setGames(await window.vanta.listGames())
    onBusy(false)
    if (res?.ok) onNotice('Ficha técnica actualizada.')
    else if (res?.error) onNotice(res.error)
  }

  const [artNote, setArtNote] = useState<string | null>(null)
  const [nota, setNota] = useState(game.note ?? '')
  const [notaGuardada, setNotaGuardada] = useState(false)

  const refreshArt = async () => {
    setArtBusy(true)
    setArtNote(null)
    const art = await window.vanta.refreshArt(game.id)
    setGames(await window.vanta.listGames())
    setArtBusy(false)
    if (!art || art.source === 'ninguna') {
      setArtNote('No he encontrado nada. Steam no tiene arte de este juego en su caché local.')
      return
    }
    const piezas = [
      art.cover && 'carátula',
      art.hero && 'fondo',
      art.logo && 'logotipo',
      art.icon && 'icono'
    ].filter(Boolean)
    setArtNote(`${art.source}: ${piezas.join(', ')}.`)
  }

  const spec = game.spec
  const pe = spec?.mainExecutablePe

  return (
    <>
      <section className="section" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>
        <h3>
          Ficha técnica
          {game.baseline && (
            <button className="btn quiet" style={{ marginLeft: 12 }} onClick={reanalyze} disabled={busy}>
              Volver a analizar
            </button>
          )}
        </h3>
        {!spec ? (
          <p className="note">
            Sin analizar. Fija la línea base y VANTA leerá las cabeceras de los ejecutables para
            deducir motor, API gráfica y anticheat.
          </p>
        ) : (
          <dl className="facts">
            <dt>Plataforma</dt>
            <dd>
              {PLATFORM_LABEL[game.platform] ?? game.platform}
              {game.appId && <span className="note"> · id {game.appId}</span>}
              {game.buildId && <span className="note"> · compilación {game.buildId}</span>}
            </dd>

            <dt>Motor</dt>
            <dd>
              {spec.engine}
              {spec.engineEvidence.length > 0 && (
                <ul className="evidence">
                  {spec.engineEvidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </dd>

            <dt>API gráfica</dt>
            <dd>
              {spec.apis.length === 0 ? (
                <span className="note">No se ha podido determinar.</span>
              ) : (
                <>
                  <div>
                    {spec.apis.map((a) => (
                      <span className="chip" key={a.api} data-conf={a.confidence}>
                        {API_LABEL[a.api] ?? a.api}
                        <span className="conf">confianza {a.confidence}</span>
                      </span>
                    ))}
                  </div>
                  <ul className="evidence">
                    {spec.apis.flatMap((a) => a.evidence.map((e) => <li key={a.api + e}>{e}</li>))}
                  </ul>
                </>
              )}
            </dd>

            <dt>Arquitectura</dt>
            <dd>{spec.arch}</dd>

            <dt>Ejecutable principal</dt>
            <dd className="mono">{spec.mainExecutable ?? '—'}</dd>

            {pe && (
              <>
                <dt>Editor declarado</dt>
                <dd>
                  {[pe.companyName, pe.productName].filter(Boolean).join(' · ') || '—'}
                  {pe.fileVersion && <span className="note"> · versión {pe.fileVersion}</span>}
                </dd>
                <dt>Firma incrustada</dt>
                <dd>{pe.hasEmbeddedSignature ? 'sí' : 'no'}</dd>
                <dt>Compilado el</dt>
                <dd>{dateTime(pe.timestamp)}</dd>
              </>
            )}

            <dt>Carátula</dt>
            <dd>
              {game.art?.source ?? 'ninguna'}
              <button
                className="btn quiet"
                style={{ marginLeft: 10 }}
                onClick={refreshArt}
                disabled={artBusy || busy}
              >
                {artBusy ? 'Buscando…' : 'Volver a buscarla'}
              </button>
              {artNote && (
                <div className="note" style={{ marginTop: 4 }}>
                  {artNote}
                </div>
              )}
            </dd>

            {game.registryKey && (
              <>
                <dt>Ajustes en el registro</dt>
                <dd>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {game.registryKey}
                  </span>
                  <button
                    className="btn quiet"
                    style={{ marginLeft: 10 }}
                    onClick={() => setRegistry({ root: 0, rel: `registro:${game.registryKey}` })}
                  >
                    Ver qué cambió
                  </button>
                  <div className="note" style={{ marginTop: 4 }}>
                    Este juego guarda parte de sus opciones aquí en vez de en archivos. VANTA las
                    lee y las compara, pero nunca escribe en el registro.
                  </div>
                </dd>
              </>
            )}

            <dt>Anticheat</dt>
            <dd>
              {spec.antiCheat.length === 0 ? (
                <span className="note">ninguno detectado</span>
              ) : (
                spec.antiCheat.map((a) => a.name).join(', ')
              )}
            </dd>

            {spec.redistributables.length > 0 && (
              <>
                <dt>Redistribuibles</dt>
                <dd className="note">{spec.redistributables.join(', ')}</dd>
              </>
            )}
          </dl>
        )}

        {spec && spec.antiCheat.length > 0 && (
          <div className="warn">
            <strong>Cuidado con los mods aquí.</strong> Este juego lleva{' '}
            {spec.antiCheat.map((a) => a.name).join(' y ')}. Modificar archivos puede costarte una
            sanción o el cierre de la cuenta, sobre todo si juegas en línea.
          </div>
        )}
      </section>

      {spec && spec.proxyDlls.length > 0 && (() => {
        const detected = new Set(spec.apis.map((a) => a.api))
        const HIJACK: Record<string, GraphicsApi[]> = {
          'Direct3D 9': ['dx9'],
          'Direct3D 10': ['dx10'],
          'Direct3D 11': ['dx11'],
          'Direct3D 12': ['dx12'],
          'DXGI (DX11/DX12)': ['dx11', 'dx12'],
          OpenGL: ['opengl']
        }
        const mismatched = spec.apis.length
          ? spec.proxyDlls.filter((d) => {
              const needs = HIJACK[d.hijacks]
              return needs && !needs.some((a) => detected.has(a))
            })
          : []
        return (
        <section className="section">
          <h3>DLL que interceptan una API</h3>
          <p className="note">
            Están sueltas en la raíz y suplantan a una librería del sistema. Es como se instalan
            ReShade, ENB, DXVK y los cargadores de mods.
          </p>
          <table className="files">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Suplanta a</th>
                <th>Se identifica como</th>
              </tr>
            </thead>
            <tbody>
              {spec.proxyDlls.map((d) => (
                <tr key={d.file}>
                  <td>{d.file}</td>
                  <td>{d.hijacks}</td>
                  <td>{d.identifiedAs ?? 'sin datos de versión'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mismatched.length > 0 && (
            <div className="warn">
              <strong>Una de estas no encaja con el juego.</strong>{' '}
              {mismatched.map((d) => d.file).join(', ')} intercepta{' '}
              {mismatched.map((d) => d.hijacks).join(', ')}, pero este juego usa{' '}
              {spec.apis.map((a) => API_LABEL[a.api] ?? a.api).join(' o ')}. Puesta ahí no hará
              nada, y en algunos casos impide que el juego arranque.
            </div>
          )}
        </section>
        )
      })()}

      <section className="section">
        <h3>Tus notas</h3>
        <p className="note" style={{ marginTop: 0 }}>
          Lo que quieras acordarte dentro de tres meses: cómo instalaste algo, qué hay que repetir
          tras cada parche, qué preajuste te gustaba.
        </p>
        <textarea
          className="nota"
          value={nota}
          rows={4}
          placeholder="Para que el HDR funcione hay que activarlo también en Windows. REFramework hay que actualizarlo a mano cada parche…"
          onChange={(e) => setNota(e.target.value)}
          onBlur={guardarNota}
        />
        <div className="group-actions" style={{ marginTop: 8 }}>
          <button className="btn" onClick={guardarNota} disabled={nota === (game.note ?? '')}>
            Guardar
          </button>
          {notaGuardada && <span className="note">Guardada.</span>}
        </div>
      </section>

      <section className="section">
        <h3>Carpetas externas</h3>

        {game.linkedPaths.length === 0 ? (
          <p className="note">
            No vigilas ninguna todavía. Los ajustes y las partidas de muchos juegos viven en
            Documentos o AppData, fuera de la carpeta del juego.
          </p>
        ) : (
          <>
            <p className="note" style={{ marginTop: 0 }}>
              Estas entran en la línea base junto con la carpeta del juego.
            </p>
            <table className="files">
              <thead>
                <tr>
                  <th>Ruta</th>
                  <th>Tipo</th>
                  <th>Protegida</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {game.linkedPaths.map((l) => (
                  <tr key={l.path}>
                    <td title={l.path}>{l.path}</td>
                    <td>{KIND_LABEL[l.kind]}</td>
                    <td>
                      <button className="btn quiet" onClick={() => toggleProtect(l.path)}>
                        {l.protected ? 'sí, nunca se purga' : 'no'}
                      </button>
                    </td>
                    <td>
                      <button className="btn quiet" onClick={() => removeLink(l.path)}>
                        Dejar de vigilar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={findLinks} disabled={busy || searching}>
            {searching ? 'Buscando…' : 'Buscar carpetas de este juego'}
          </button>
        </div>

        {suggestions && (
          <div style={{ marginTop: 12 }}>
            {suggestions.length === 0 ? (
              <p className="note">No hay carpetas nuevas que se parezcan a este juego.</p>
            ) : (
              <>
                <p className="note">
                  Candidatas encontradas. Haz clic en una para empezar a vigilarla.
                </p>
                {suggestions.map((s) => (
                  <div key={s.path} className="pick" onClick={() => addLink(s)}>
                    <div>
                      <div className="n">
                        {s.label}
                        <span className="note"> · {KIND_LABEL[s.kind]}</span>
                        {s.protected && <span className="note"> · contiene partidas</span>}
                      </div>
                      <div className="p">{s.path}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </section>

      <section className="section">
        <h3>Línea base</h3>
        {!game.baseline ? (
          <p className="note">
            Sin fijar. Hasta que no exista, VANTA no puede distinguir lo original de lo añadido.
          </p>
        ) : (
          <>
            <dl className="facts">
              <dt>Tomada el</dt>
              <dd>{dateTime(game.baseline.takenAt)}</dd>
              <dt>Archivos</dt>
              <dd className="mono">{count(game.baseline.fileCount)}</dd>
              <dt>Peso total</dt>
              <dd className="mono">{bytes(game.baseline.totalBytes)}</dd>
              <dt>Tardó</dt>
              <dd className="mono">{duration(game.baseline.durationMs)}</dd>
              {game.baseline.unreadable ? (
                <>
                  <dt>No legibles</dt>
                  <dd className="mono">
                    {count(game.baseline.unreadable)}
                    <span className="note"> · bloqueados o sin permisos; no están en la línea base</span>
                  </dd>
                </>
              ) : null}
              <dt>Copia de originales</dt>
              <dd className={originals ? 'mono' : undefined}>
                {originals ? (
                  `${count(originals.fileCount)} archivos · ${bytes(originals.totalBytes)}`
                ) : (
                  <>
                    ninguna
                    <span className="note">
                      {' '}
                      · rehaz la línea base para guardarla y poder revertir un original
                      sobrescrito con un clic
                    </span>
                  </>
                )}
              </dd>
              <dt>Raíces</dt>
              <dd className="mono">
                {game.baseline.roots.map((r) => (
                  <div key={r.path}>
                    {r.path} · {count(r.fileCount)} archivos · {bytes(r.totalBytes)}
                  </div>
                ))}
              </dd>
            </dl>

            {sample && sample.length > 0 && (
              <>
                <p className="note" style={{ margin: '18px 0 8px' }}>
                  Primeros {count(sample.length)} archivos registrados, con su huella SHA-256.
                </p>
                <table className="files">
                  <thead>
                    <tr>
                      <th>Ruta</th>
                      <th className="num">Tamaño</th>
                      <th>Huella</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sample.map((f) => (
                      <tr key={f.root + f.rel}>
                        <td title={f.rel}>{f.rel}</td>
                        <td className="num">{bytes(f.size)}</td>
                        <td>{f.sha256.slice(0, 16)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </section>

      {registry && (
        <ConfigDiffView
          gameId={game.id}
          root={registry.root}
          rel={registry.rel}
          onClose={() => setRegistry(null)}
          onNotice={() => {}}
          onReverted={() => {}}
        />
      )}
    </>
  )
}
