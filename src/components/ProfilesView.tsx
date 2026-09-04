/**
 * Pestaña de perfiles: lanzar el juego con o sin perfiles, y montar,
 * desmontar, editar y eliminar cada perfil. Un perfil solo mueve los archivos
 * que le pertenecen; lo que no esté en un perfil no lo toca nadie desde aquí.
 */

import { useEffect, useState } from 'react'
import type { Game, Profile } from '../../shared/types'
import { bytes, count, dateTime } from '../store'

interface Props {
  game: Game
  busy: boolean
  onBusy: (b: boolean) => void
  onNotice: (msg: string) => void
  onChanged: () => void
}

export default function ProfilesView({ game, busy, onBusy, onNotice, onChanged }: Props) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [colors, setColors] = useState<string[]>([])
  const [returnClean, setReturnClean] = useState(true)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null)
  const [riesgo, setRiesgo] = useState<{
    mode: 'limpio' | 'tal cual' | 'perfil'
    profileId: string | null
    montado: string[]
  } | null>(null)
  const [escrito, setEscrito] = useState('')

  const refresh = () => window.vanta.listProfiles(game.id).then(setProfiles)

  useEffect(() => {
    setProfiles(null)
    refresh()
    window.vanta.profileColors().then(setColors)
    return window.vanta.onProfilesChanged((p) => {
      if (p[0]?.gameId === game.id || p.length === 0) refresh()
    })
  }, [game.id])

  const toggle = async (p: Profile) => {
    onBusy(true)
    const res = await window.vanta.setProfileMounted(p.id, !p.mounted)
    onBusy(false)
    if (res?.ok) {
      setProfiles(res.profiles)
      onChanged()
      const skipped = res.skipped?.length ?? 0
      onNotice(
        `${p.name}: ${p.mounted ? 'desmontado' : 'montado'} · ${count(res.moved)} archivos movidos` +
          (skipped ? ` · ${count(skipped)} saltados` : '')
      )
    } else if (res?.error) {
      onNotice(res.error)
    }
  }

  const anticheat = game.spec?.antiCheat ?? []

  /**
   * Antes de lanzar comprueba si va a quedar algo montado en un juego con
   * anticheat. Ahí no vale un aviso que se cierra sin leer: hay que escribirlo.
   */
  const pedirJugar = (mode: 'limpio' | 'tal cual' | 'perfil', profileId: string | null) => {
    const quedaran =
      mode === 'limpio'
        ? []
        : mode === 'perfil'
          ? (profiles ?? []).filter((p) => p.id === profileId).map((p) => p.name)
          : (profiles ?? []).filter((p) => p.mounted).map((p) => p.name)
    if (anticheat.length && quedaran.length) {
      setEscrito('')
      setRiesgo({ mode, profileId, montado: quedaran })
      return
    }
    play(mode, profileId)
  }

  const play = async (mode: 'limpio' | 'tal cual' | 'perfil', profileId: string | null) => {
    setRiesgo(null)
    onBusy(true)
    const res = await window.vanta.launch(game.id, mode, profileId, returnClean)
    onBusy(false)
    if (res?.ok) {
      setProfiles(res.profiles)
      onChanged()
      onNotice(
        'Juego lanzado.' +
          (res.watching ? ' Al cerrarlo, VANTA desmontará todo y dejará la carpeta limpia.' : '') +
          (res.skipped?.length ? ` ${count(res.skipped.length)} archivos no se pudieron mover.` : '')
      )
    } else if (res?.error) {
      onNotice(res.error)
    }
  }

  const remove = async () => {
    if (!confirmDelete) return
    onBusy(true)
    const res = await window.vanta.deleteProfile(confirmDelete.id)
    onBusy(false)
    setConfirmDelete(null)
    if (res?.ok) {
      setProfiles(res.profiles)
      onChanged()
      onNotice('Perfil eliminado. Sus archivos han vuelto a la carpeta del juego.')
    }
  }

  if (!game.baseline) {
    return (
      <p className="note">
        Los perfiles se crean a partir de los grupos de la pestaña de cambios, así que primero hace
        falta una línea base y una revisión.
      </p>
    )
  }

  const mounted = profiles?.filter((p) => p.mounted) ?? []
  const hasProfiles = (profiles?.length ?? 0) > 0

  return (
    <>
      {anticheat.length > 0 && (
        <div className="warn">
          <strong>Este juego lleva {anticheat.map((a) => a.name).join(' y ')}.</strong> Jugar en
          línea con archivos modificados puede costarte una sanción o el cierre de la cuenta. Para
          jugar en línea, usa «Jugar limpio».
        </div>
      )}

      <div className="play">
        <div className="play-row">
          <button className="btn primary" onClick={() => pedirJugar('tal cual', null)} disabled={busy}>
            Jugar tal como está
          </button>
          {hasProfiles && (
            <button className="btn" onClick={() => pedirJugar('limpio', null)} disabled={busy}>
              Jugar limpio
            </button>
          )}
          {profiles?.map((p) => (
            <button
              key={p.id}
              className="btn"
              onClick={() => pedirJugar('perfil', p.id)}
              disabled={busy}
              style={{ borderColor: p.color }}
            >
              Jugar con {p.name}
            </button>
          ))}
        </div>
        {hasProfiles ? (
          <>
            <label className="field inline" style={{ margin: '10px 0 0' }}>
              <input type="checkbox" checked={returnClean} onChange={(e) => setReturnClean(e.target.checked)} />
              Desmontar todos los perfiles al cerrar el juego
            </label>
            <p className="note" style={{ margin: '6px 0 0' }}>
              Perfiles montados ahora: {mounted.length ? mounted.map((p) => p.name).join(', ') : 'ninguno'}
            </p>
          </>
        ) : (
          <p className="note" style={{ margin: '10px 0 0' }}>
            Sin perfiles, jugar es simplemente lanzar el juego con lo que tenga puesto. «Jugar limpio»
            aparecerá cuando guardes algún grupo como perfil, porque solo puede desmontar lo que está en
            un perfil.
          </p>
        )}
      </div>

      <section className="section">
        <h3>Perfiles</h3>
        {profiles === null ? (
          <p className="note">Cargando…</p>
        ) : profiles.length === 0 ? (
          <p className="note">
            Todavía no hay ninguno. En la pestaña de cambios, cualquier grupo tiene un botón para
            guardarlo como perfil. A partir de ahí puedes montarlo y desmontarlo cuando quieras.
          </p>
        ) : (
          profiles.map((p) => (
            <article
              className="group"
              key={p.id}
              style={{ ['--stripe' as string]: p.color, opacity: p.mounted ? 1 : 0.62 }}
            >
              <div className="stripe" />
              <div className="inner">
                <div className="group-head">
                  <span className="title">{p.name}</span>
                  <span className="cat">{p.mounted ? 'montado' : 'desmontado'}</span>
                  <span className="count">
                    {count(p.fileCount)} archivos · {bytes(p.totalBytes)}
                  </span>
                </div>
                <div className="why">Creado el {dateTime(p.createdAt)}</div>
                {p.note && <div className="why">{p.note}</div>}
                <div className="group-actions">
                  <button className="btn" onClick={() => toggle(p)} disabled={busy}>
                    {p.mounted ? 'Desmontar' : 'Montar'}
                  </button>
                  <button className="btn quiet" onClick={() => setEditing(p)} disabled={busy}>
                    Editar
                  </button>
                  <button
                    className="btn quiet danger"
                    onClick={() => setConfirmDelete(p)}
                    disabled={busy}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      {riesgo && (
        <div className="overlay" onClick={() => setRiesgo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Vas a jugar con {anticheat.map((a) => a.name).join(' y ')} y mods puestos</h2>
            </header>
            <div className="scroll" style={{ padding: '12px 20px' }}>
              <p style={{ marginTop: 0 }}>
                Quedará montado: <strong>{riesgo.montado.join(', ')}</strong>.
              </p>
              <p>
                Un anticheat comprueba que los archivos del juego sean los originales. Si detecta
                los mods, la sanción no la levanta nadie y puedes perder la cuenta entera, no solo
                el juego.
              </p>
              <p className="note">
                Si es una partida a solas y sin conexión, normalmente no pasa nada. Si vas a jugar
                en línea, cancela y usa «Jugar limpio».
              </p>
              <label className="field">
                <span>Para continuar, escribe: jugar igualmente</span>
                <input
                  type="text"
                  value={escrito}
                  autoFocus
                  onChange={(e) => setEscrito(e.target.value)}
                  placeholder="jugar igualmente"
                />
              </label>
            </div>
            <footer>
              <button className="btn primary" onClick={() => setRiesgo(null)}>
                Cancelar
              </button>
              <button
                className="btn quiet"
                onClick={() => play('limpio', null)}
              >
                Desmontar todo y jugar limpio
              </button>
              <button
                className="btn quiet danger"
                disabled={escrito.trim().toLowerCase() !== 'jugar igualmente'}
                onClick={() => play(riesgo.mode, riesgo.profileId)}
              >
                Jugar igualmente
              </button>
            </footer>
          </div>
        </div>
      )}

      {editing && (
        <EditProfile
          profile={editing}
          colors={colors}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setProfiles(list)
            setEditing(null)
          }}
        />
      )}

      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Eliminar «{confirmDelete.name}»</h2>
            </header>
            <div className="scroll" style={{ padding: '12px 20px' }}>
              <p style={{ margin: 0 }}>
                Se elimina el perfil, pero sus {count(confirmDelete.fileCount)} archivos vuelven a
                la carpeta del juego si estaban desmontados. VANTA no se queda con nada tuyo.
              </p>
            </div>
            <footer>
              <button className="btn quiet" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </button>
              <button className="btn danger" onClick={remove} disabled={busy}>
                Eliminar el perfil
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

function EditProfile({
  profile,
  colors,
  onClose,
  onSaved
}: {
  profile: Profile
  colors: string[]
  onClose: () => void
  onSaved: (list: Profile[]) => void
}) {
  const [name, setName] = useState(profile.name)
  const [color, setColor] = useState(profile.color)
  const [note, setNote] = useState(profile.note ?? '')

  const save = async () => {
    const list = await window.vanta.updateProfile(profile.id, {
      name: name.trim() || profile.name,
      color,
      note: note.trim() || undefined
    })
    if (list) onSaved(list)
    else onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Editar perfil</h2>
        </header>
        <div className="scroll" style={{ padding: '4px 20px 12px' }}>
          <label className="field">
            <span>Nombre</span>
            <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Nota</span>
            <input
              type="text"
              value={note}
              placeholder="Para las partidas largas, mata bastante rendimiento…"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="field">
            <span>Color</span>
            <div className="swatches">
              {colors.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
        <footer>
          <button className="btn quiet" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save}>
            Guardar
          </button>
        </footer>
      </div>
    </div>
  )
}
