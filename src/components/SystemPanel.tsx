import { useState } from 'react'
import type { Game, InjectedModule, RunningApp } from '../../shared/types'
import { bytes, count } from '../store'

const COLOR: Record<string, string> = {
  navegador: 'var(--c-content)',
  comunicacion: 'var(--c-api)',
  captura: 'var(--c-post)',
  periféricos: 'var(--c-manager)',
  nube: 'var(--c-config)',
  tienda: 'var(--c-loader)',
  sistema: 'var(--c-save)'
}

interface Dentro {
  running: boolean
  pid?: number
  blocked?: boolean
  reason?: string
  modules?: InjectedModule[]
}

/**
 * Lo que compite con el juego.
 *
 * No ordena por memoria a lo bruto, porque engaña: la RAM de un programa
 * parado casi no le quita nada al juego. Lo que se pone primero es lo que se
 * mete dentro del proceso y lo que consume CPU de verdad.
 */
export default function SystemPanel({
  game,
  onNotice
}: {
  game: Game
  onNotice: (m: string) => void
}) {
  const [apps, setApps] = useState<RunningApp[] | null>(null)
  const [dentro, setDentro] = useState<Dentro | null>(null)
  const [busy, setBusy] = useState(false)
  const [todo, setTodo] = useState(false)

  const mirar = async () => {
    setBusy(true)
    const [lista, adentro] = await Promise.all([
      window.vanta.running(),
      window.vanta.insideGame(game.id)
    ])
    setApps(lista)
    setDentro(adentro)
    setBusy(false)
  }

  const cerrar = async (app: RunningApp) => {
    const res = await window.vanta.closeApp(app.pid, app.name)
    if (res?.ok) {
      onNotice(`Se ha pedido a ${app.label} que se cierre. Si tenía algo sin guardar, te preguntará.`)
      setApps((prev) => prev?.filter((a) => a.pid !== app.pid) ?? null)
    } else if (res?.error) {
      onNotice(res.error)
    }
  }

  // Lo interesante: lo que se inyecta, o lo que consume de verdad.
  const relevantes =
    apps?.filter((a) => a.known?.injects || a.cpuPercent >= 1 || a.known?.closeable) ?? []
  const visibles = todo ? (apps ?? []) : relevantes.slice(0, 12)
  const ajenos = dentro?.modules ?? []

  return (
    <section className="section">
      <h3>Qué más está corriendo</h3>

      {!apps && (
        <p className="note" style={{ marginTop: 0 }}>
          Mira qué hay abierto que pueda quitarle fotogramas al juego. Lo que más molesta no es lo
          que ocupa memoria, sino lo que se mete dentro del juego (superposiciones, capturas,
          programas de luces) y lo que compite por la CPU.
        </p>
      )}

      <div className="group-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={mirar} disabled={busy}>
          {busy ? 'Midiendo…' : apps ? 'Volver a mirar' : 'Mirar ahora'}
        </button>
      </div>

      {dentro && (
        <div style={{ marginTop: 16 }}>
          <h4 className="diff-title" style={{ marginTop: 0 }}>
            Dentro del juego
          </h4>
          {!dentro.running ? (
            <p className="note">
              {dentro.reason ??
                'El juego no está abierto. Ábrelo y vuelve a mirar para ver qué se le mete dentro.'}
            </p>
          ) : dentro.blocked ? (
            <p className="note">{dentro.reason}</p>
          ) : ajenos.length === 0 ? (
            <p className="note">
              Nada ajeno cargado. Solo hay librerías del propio juego y de Windows.
            </p>
          ) : (
            <>
              <p className="note" style={{ marginTop: 0 }}>
                {count(ajenos.length)} librerías que no vienen ni del juego ni de Windows. Algunas
                serán tus mods; otras, programas que se han enganchado solos.
              </p>
              <table className="files">
                <tbody>
                  {ajenos.map((m) => (
                    <tr key={m.file}>
                      <td>{m.name}</td>
                      <td className="note" title={m.file}>
                        {m.file}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {apps && (
        <div style={{ marginTop: 18 }}>
          <h4 className="diff-title" style={{ marginTop: 0 }}>
            Programas abiertos
          </h4>
          <table className="files">
            <thead>
              <tr>
                <th>Programa</th>
                <th className="num">CPU</th>
                <th className="num">Memoria</th>
                <th>Por qué importa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) => (
                <tr key={a.pid + a.label}>
                  <td>
                    {a.known && (
                      <span className="dot" style={{ background: COLOR[a.known.category] }} />
                    )}
                    {a.label}
                  </td>
                  <td className="num" style={a.cpuPercent >= 5 ? { color: 'var(--c-loader)' } : undefined}>
                    {a.cpuPercent > 0 ? `${a.cpuPercent}%` : '—'}
                  </td>
                  <td className="num">{bytes(a.memoryBytes)}</td>
                  <td className="note">
                    {a.known?.injects && (
                      <strong style={{ color: 'var(--c-post)' }}>se mete en el juego · </strong>
                    )}
                    {a.known?.why ?? 'no lo conozco; míralo tú antes de cerrarlo'}
                  </td>
                  <td className="acciones">
                    {a.known?.closeable !== false && a.hasWindow && (
                      <button className="btn quiet" onClick={() => cerrar(a)}>
                        Cerrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!todo && (apps?.length ?? 0) > visibles.length && (
            <div className="group-actions">
              <button className="btn quiet" onClick={() => setTodo(true)}>
                Ver los {count(apps.length)} procesos
              </button>
            </div>
          )}

          <p className="note" style={{ marginTop: 10 }}>
            «Cerrar» le pide la ventana al programa, igual que darle a la equis: si tiene algo sin
            guardar te lo preguntará. VANTA nunca mata un proceso ni toca nada de Windows, del
            controlador gráfico o de un anticheat.
          </p>
        </div>
      )}
    </section>
  )
}
