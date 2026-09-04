/**
 * Pestaña de cambios.
 *
 * Muestra la última revisión agrupada por categoría, con las acciones de cada
 * grupo: purgar, nombrar lo desconocido, guardarlo como perfil, deshacer
 * renombrados, ver sus archivos y comparar configuraciones. Aquí se lanzan
 * también la revisión rápida, la verificación profunda y la purga total.
 */

import { useEffect, useState } from 'react'
import type { Category, ChangeReport, Conflict, FileGroup, Game } from '../../shared/types'
import { CATEGORY, CATEGORY_ORDER } from '../categories'
import { bytes, count, dateTime, duration } from '../store'
import ConfigDiffView from './ConfigDiffView'

interface Props {
  game: Game
  busy: boolean
  report: ChangeReport | null
  onReport: (r: ChangeReport | null) => void
  onBusy: (b: boolean) => void
  onNotice: (msg: string) => void
}

/** Extensiones que VANTA sabe comparar clave por clave. */
const CONFIG_EXT = /\.(ini|cfg|conf|properties|settings|prefs|toml|xml|json)$/i

interface Plan {
  quarantine: number
  quarantineBytes: number
  restore: number
  stuck: number
  blockedGroups: string[]
  groups: { name: string; category: string }[]
}

export default function ChangesView({ game, busy, report, onReport, onBusy, onNotice }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [saving, setSaving] = useState<FileGroup | null>(null)
  const [inspect, setInspect] = useState<{ root: number; rel: string } | null>(null)
  const [colors, setColors] = useState<string[]>([])
  const [naming, setNaming] = useState<FileGroup | null>(null)
  const [confirming, setConfirming] = useState<{ groupId: string | null; plan: Plan } | null>(null)

  useEffect(() => {
    window.vanta.profileColors().then(setColors)
  }, [])

  // Los conflictos se recalculan con cada revisión nueva y tras cada purga.
  useEffect(() => {
    if (report) window.vanta.listConflicts(game.id).then(setConflicts)
    else setConflicts([])
  }, [game.id, report?.takenAt, report?.entries.length])

  const scan = async (deep: boolean) => {
    onBusy(true)
    const res = await window.vanta.scanChanges(game.id, deep)
    onBusy(false)
    if (res?.ok) onReport(res.report)
    else if (res?.error) onNotice(res.error)
  }

  const undoRenames = async (groupId: string) => {
    onBusy(true)
    const res = await window.vanta.undoRenames(game.id, groupId)
    onBusy(false)
    if (res?.ok) {
      onReport(null)
      onNotice(
        `${count(res.done)} archivos han recuperado su nombre original` +
          (res.failed?.length ? ` · ${count(res.failed.length)} no se pudieron mover` : '') +
          '. Vuelve a buscar cambios para ver cómo queda.'
      )
    } else if (res?.error) {
      onNotice(res.error)
    }
  }

  const askPurge = async (groupId: string | null) => {
    const plan = await window.vanta.purgePreview(game.id, groupId)
    if (plan) setConfirming({ groupId, plan })
  }

  const runPurge = async () => {
    if (!confirming) return
    onBusy(true)
    const res = await window.vanta.purgeRun(game.id, confirming.groupId)
    onBusy(false)
    setConfirming(null)
    if (res?.ok) {
      onReport(res.report)
      const parts = [`${count(res.moved)} archivos a cuarentena (${bytes(res.movedBytes)})`]
      if (res.restored) parts.push(`${count(res.restored)} originales restaurados`)
      if (res.stuck) parts.push(`${count(res.stuck)} sin copia original, intactos`)
      onNotice(parts.join(' · '))
    } else if (res?.error) {
      onNotice(res.error)
    }
  }

  if (!game.baseline) {
    return (
      <p className="note">
        Este juego no tiene línea base. Fíjala primero en la pestaña de resumen: sin ella no hay
        nada con lo que comparar.
      </p>
    )
  }

  const totals = report
    ? {
        nuevo: report.entries.filter((e) => e.status === 'nuevo').length,
        modificado: report.entries.filter((e) => e.status === 'modificado').length,
        desaparecido: report.entries.filter((e) => e.status === 'desaparecido').length
      }
    : null

  return (
    <>
      <div className="view-actions" style={{ marginTop: 0 }}>
        <button className="btn primary" onClick={() => scan(false)} disabled={busy}>
          Buscar cambios
        </button>
        <button className="btn quiet" onClick={() => scan(true)} disabled={busy}>
          Verificación profunda
        </button>
        {report && report.entries.length > 0 && (
          <button className="btn danger" onClick={() => askPurge(null)} disabled={busy}>
            Purga total
          </button>
        )}
      </div>

      {!report ? (
        <p className="note">
          Todavía no has revisado este juego. «Buscar cambios» compara el disco contra la línea
          base y solo lee los archivos cuyo tamaño o fecha no cuadran, así que tarda segundos. La
          verificación profunda recalcula todo, por si un mod sobrescribió conservando la fecha.
        </p>
      ) : (
        <>
          <p className="note" style={{ marginTop: 0 }}>
            {report.deep ? 'Verificación profunda' : 'Revisión rápida'} del{' '}
            {dateTime(report.takenAt)} · {count(report.rehashed)} archivos releídos en{' '}
            {duration(report.durationMs)} · línea base del {dateTime(report.baselineTakenAt)}
            {report.unreadable ? ` · ${count(report.unreadable)} archivos no se pudieron leer` : ''}
          </p>

          {report.buildIdChanged && (
            <div className="warn">
              <strong>El juego se ha actualizado.</strong> La línea base es de la compilación{' '}
              {report.buildIdChanged.from} y ahora hay la {report.buildIdChanged.to}. Los archivos
              del parche saldrán aquí como cambios ajenos. Rehaz la línea base antes de purgar
              nada.
            </div>
          )}

          {totals && (
            <div className="tallies">
              <div>
                <b>{count(totals.nuevo)}</b>
                <span>nuevos</span>
              </div>
              <div>
                <b>{count(totals.modificado)}</b>
                <span>modificados</span>
              </div>
              <div>
                <b>{count(totals.desaparecido)}</b>
                <span>desaparecidos</span>
              </div>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="conflict">
              <strong>Hay mods que han sobrescrito archivos originales.</strong>
              <ul className="evidence" style={{ marginTop: 6 }}>
                {conflicts.map((c) => (
                  <li key={c.groupId}>
                    {c.groupName} ha pisado {count(c.files.length)}{' '}
                    {c.files.length === 1 ? 'archivo original' : 'archivos originales'} ·{' '}
                    {c.recoverable === c.files.length
                      ? 'todos recuperables'
                      : `${count(c.recoverable)} recuperables`}
                  </li>
                ))}
              </ul>
              Si dos de estos tocan el mismo archivo, el último que instalaste gana. Es la causa
              más común de que un mod deje de funcionar sin motivo aparente.
            </div>
          )}

          {report.entries.length > 0 && (
            <input
              className="changes-filter"
              placeholder="Filtrar por ruta"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filtrar los cambios por ruta"
            />
          )}

          {report.entries.length === 0 ? (
            <p className="note">
              La carpeta está exactamente como la dejaste. Ni un archivo de diferencia.
            </p>
          ) : (
            report.groups
              .slice()
              .sort(
                (a, b) =>
                  CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
                  b.fileCount - a.fileCount
              )
              .map((group) => {
                const meta = CATEGORY[group.category]
                const q = filter.trim().toLowerCase()
                const all = report.entries.filter((e) => e.groupId === group.id)
                const members = q ? all.filter((e) => e.rel.toLowerCase().includes(q)) : all
                if (q && !members.length) return null
                const isOpen = open.has(group.id) || (!!q && members.length > 0)
                return (
                  <article
                    className="group"
                    key={group.id}
                    style={{ ['--stripe' as string]: meta.color }}
                  >
                    <div className="stripe" />
                    <div className="inner">
                      <div className="group-head">
                        <span className="title">{group.name}</span>
                        <span className="cat" title={meta.hint}>
                          {meta.label}
                        </span>
                        <span className="count">
                          {q
                            ? `${count(members.length)} de ${count(group.fileCount)} archivos`
                            : `${count(group.fileCount)} archivos · ${bytes(group.totalBytes)}`}
                        </span>
                      </div>
                      <div className="why">{group.detectedBy}</div>

                      <div className="group-actions">
                        {!group.locked && (
                          <>
                            <button
                              className="btn danger"
                              onClick={() => askPurge(group.id)}
                              disabled={busy}
                            >
                              Purgar este grupo
                            </button>
                            <button className="btn quiet" onClick={() => setNaming(group)}>
                              {group.category === 'desconocido' ? '¿Qué es esto?' : 'Renombrar'}
                            </button>
                            {group.counts.nuevo > 0 && (
                              <button className="btn quiet" onClick={() => setSaving(group)}>
                                Guardar como perfil
                              </button>
                            )}
                          </>
                        )}
                        {group.id === 'respaldo-renombrado' && (
                          <button
                            className="btn primary"
                            onClick={() => undoRenames(group.id)}
                            disabled={busy}
                          >
                            Devolverles su nombre original
                          </button>
                        )}
                        <button
                          className="btn quiet"
                          onClick={() =>
                            setOpen((s) => {
                              const n = new Set(s)
                              n.has(group.id) ? n.delete(group.id) : n.add(group.id)
                              return n
                            })
                          }
                        >
                          {isOpen ? 'Ocultar archivos' : 'Ver archivos'}
                        </button>
                      </div>

                      {group.locked && (
                        <div className="lockmsg">
                          {group.category === 'ausente'
                            ? 'No se puede purgar lo que ya no está. Si no los borraste tú, verifica la integridad del juego en la tienda para recuperarlos.'
                            : group.category === 'respaldo'
                              ? 'Purgarlos borraría el único ejemplar de un archivo original. Deshaz el renombrado y volverán a su sitio.'
                              : 'Protegido. VANTA no toca este grupo ni con la purga total.'}
                        </div>
                      )}

                      {isOpen && (
                        <table className="files" style={{ marginTop: 12 }}>
                          <thead>
                            <tr>
                              <th>Ruta</th>
                              <th>Estado</th>
                              <th className="num">Tamaño</th>
                              <th>Modificado</th>
                              <th>Identidad</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {members.slice(0, 300).map((e) => (
                              <tr key={`${e.root}|${e.rel}`}>
                                <td title={e.rel}>
                                  {game.baseline!.roots.length > 1 && (
                                    <span className="note">[{e.root}] </span>
                                  )}
                                  {e.rel}
                                </td>
                                <td>
                                  <span className="status" data-s={e.status}>
                                    {e.status}
                                  </span>
                                </td>
                                <td className="num">{e.size ? bytes(e.size) : '—'}</td>
                                <td title={e.mtimeMs ? new Date(e.mtimeMs).toISOString() : ''}>
                                  {e.mtimeMs ? dateTime(new Date(e.mtimeMs).toISOString()) : '—'}
                                </td>
                                <td title={e.pairedWith?.rel ?? e.identity}>
                                  {e.pairedWith
                                    ? e.pairedWith.kind === 'renombrado-desde'
                                      ? `era ${e.pairedWith.rel}`
                                      : e.pairedWith.kind === 'renombrado-a'
                                        ? `renombrado a ${e.pairedWith.rel}`
                                        : `copia de ${e.pairedWith.rel}`
                                    : (e.identity ??
                                      (e.status === 'modificado'
                                        ? e.recoverableFrom
                                          ? `original recuperable desde ${e.recoverableFrom}`
                                          : e.hasOriginal
                                            ? 'hay copia del original'
                                            : 'sin copia del original'
                                        : ''))}
                                </td>
                                <td>
                                  {CONFIG_EXT.test(e.rel) && e.status !== 'desaparecido' && (
                                    <button
                                      className="btn quiet"
                                      onClick={() => setInspect({ root: e.root, rel: e.rel })}
                                    >
                                      Ver qué cambió
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {isOpen && members.length > 300 && (
                        <p className="note">
                          Se muestran 300 de {count(members.length)}.
                        </p>
                      )}
                    </div>
                  </article>
                )
              })
          )}
        </>
      )}

      {naming && (
        <NameDialog
          group={naming}
          gameId={game.id}
          onClose={() => setNaming(null)}
          onDone={(r) => {
            onReport(r)
            setNaming(null)
          }}
        />
      )}

      {inspect && (
        <ConfigDiffView
          gameId={game.id}
          root={inspect.root}
          rel={inspect.rel}
          onClose={() => setInspect(null)}
          onNotice={onNotice}
          onReverted={() => onReport(null)}
        />
      )}

      {saving && (
        <SaveProfile
          group={saving}
          gameId={game.id}
          colors={colors}
          onClose={() => setSaving(null)}
          onDone={(name) => {
            setSaving(null)
            onNotice(`Perfil «${name}» creado. Móntalo y desmóntalo desde la pestaña Perfiles.`)
          }}
        />
      )}

      {confirming && (
        <ConfirmPurge
          plan={confirming.plan}
          total={confirming.groupId === null}
          onCancel={() => setConfirming(null)}
          onConfirm={runPurge}
        />
      )}
    </>
  )
}

function NameDialog({
  group,
  gameId,
  onClose,
  onDone
}: {
  group: FileGroup
  gameId: string
  onClose: () => void
  onDone: (r: ChangeReport) => void
}) {
  const [name, setName] = useState(group.category === 'desconocido' ? '' : group.name)
  const [category, setCategory] = useState<Category>(
    group.category === 'desconocido' ? 'contenido' : group.category
  )
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    const res = await window.vanta.nameGroup(gameId, group.id, name.trim(), category, remember)
    setBusy(false)
    if (res?.ok) onDone(res.report)
    else onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>¿Qué son estos {count(group.fileCount)} archivos?</h2>
          <p className="note" style={{ margin: '6px 0 0' }}>
            Ponles nombre y categoría. A partir de ahí VANTA los agrupa solo y podrás purgarlos de
            una vez.
          </p>
        </header>
        <div className="scroll" style={{ padding: '4px 20px 12px' }}>
          <label className="field">
            <span>Nombre</span>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="Texturas HD de Nexus, traducción al español…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
          <label className="field">
            <span>Categoría</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORY_ORDER.filter((c) => c !== 'desconocido' && c !== 'partida').map((c) => (
                <option key={c} value={c}>
                  {CATEGORY[c].label}
                </option>
              ))}
            </select>
            <span className="note" style={{ marginTop: 6 }}>
              {CATEGORY[category].hint}
            </span>
          </label>
          <label className="field inline">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Recordarlo para las próximas revisiones de este juego
          </label>
        </div>
        <footer>
          <button className="btn quiet" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            Guardar
          </button>
        </footer>
      </div>
    </div>
  )
}

function ConfirmPurge({
  plan,
  total,
  onCancel,
  onConfirm
}: {
  plan: Plan
  total: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{total ? 'Purga total' : 'Purgar grupo'}</h2>
        </header>
        <div className="scroll" style={{ padding: '10px 20px 14px' }}>
          <div className="plan">
            <div>
              <b>{count(plan.quarantine)}</b> archivos añadidos se mueven a cuarentena (
              {bytes(plan.quarantineBytes)}). No se borran: podrás devolverlos.
            </div>
            {plan.restore > 0 && (
              <div>
                <b>{count(plan.restore)}</b> archivos originales que fueron sobrescritos se
                restauran desde la copia de seguridad.
              </div>
            )}
            {plan.stuck > 0 && (
              <div>
                <b>{count(plan.stuck)}</b> archivos originales están modificados y no hay copia de
                ellos. Se quedan como están: bórralos y tendrías un hueco. Para esos, usa la
                verificación de integridad de la tienda.
              </div>
            )}
            {plan.blockedGroups.length > 0 && (
              <div style={{ marginTop: 8 }}>
                Intactos por protegidos: {plan.blockedGroups.join(', ')}.
              </div>
            )}
          </div>

          {plan.groups.length > 0 && (
            <>
              <p className="note" style={{ margin: '16px 0 6px' }}>
                Grupos afectados
              </p>
              <ul className="evidence">
                {plan.groups.map((g) => (
                  <li key={g.name}>
                    {g.name} · {g.category}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <footer>
          <button className="btn quiet" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={onConfirm}
            disabled={plan.quarantine === 0 && plan.restore === 0}
          >
            Mover a cuarentena
          </button>
        </footer>
      </div>
    </div>
  )
}

function SaveProfile({
  group,
  gameId,
  colors,
  onClose,
  onDone
}: {
  group: FileGroup
  gameId: string
  colors: string[]
  onClose: () => void
  onDone: (name: string) => void
}) {
  const [name, setName] = useState(group.name)
  const [color, setColor] = useState(colors[0] ?? '#a855f7')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    const res = await window.vanta.createProfile(gameId, group.id, name.trim(), color)
    setBusy(false)
    if (res?.ok) onDone(name.trim())
    else onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Guardar como perfil</h2>
          <p className="note" style={{ margin: '6px 0 0' }}>
            Se guardan los {count(group.counts.nuevo)} archivos añadidos de este grupo. A partir de
            ahí podrás montarlo y desmontarlo con un clic, o lanzar el juego con él puesto.
          </p>
        </header>
        <div className="scroll" style={{ padding: '4px 20px 12px' }}>
          <label className="field">
            <span>Nombre</span>
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
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
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            Crear perfil
          </button>
        </footer>
      </div>
    </div>
  )
}
