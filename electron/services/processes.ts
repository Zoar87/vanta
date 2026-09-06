/**
 * Qué más está corriendo mientras juegas.
 *
 * La medida ingenua sería ordenar por memoria y decir «cierra lo que más
 * ocupa». Engaña: la RAM de un programa parado casi no le quita nada al juego,
 * porque Windows se la cede cuando hace falta. Lo que de verdad duele es:
 *
 *   1. Lo que compite por la CPU mientras juegas.
 *   2. Lo que se mete dentro del proceso del juego: superposiciones, capturas,
 *      software de teclados y ratones. Eso engancha la tubería gráfica y cuesta
 *      fotogramas de verdad, aunque en el administrador de tareas parezca que
 *      no consume nada.
 *
 * Lo segundo es lo mismo que hace VANTA con los archivos, pero en memoria: qué
 * hay dentro que no venga del juego.
 *
 * Aquí no se mata nada por las bravas. Se pide a la ventana que se cierre, que
 * es lo mismo que darle a la equis, para que el programa pueda preguntarte si
 * quieres guardar.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cpus } from 'node:os'
import path from 'node:path'

const run = promisify(execFile)

import type { InjectedModule, KnownApp, RunningApp } from '../../shared/types'

export type { InjectedModule, KnownApp, RunningApp }

/**
 * Lo que sabemos de los programas más habituales.
 *
 * Nada de aquí se cierra solo: es solo para poder explicar por qué molesta cada
 * uno, y para no proponer jamás cerrar algo del sistema o un anticheat.
 */
const CONOCIDOS: Record<string, KnownApp> = {
  chrome: { label: 'Google Chrome', category: 'navegador', why: 'con aceleración por hardware compite por la gráfica; cada pestaña suma', injects: false, closeable: true },
  msedge: { label: 'Microsoft Edge', category: 'navegador', why: 'con aceleración por hardware compite por la gráfica', injects: false, closeable: true },
  firefox: { label: 'Firefox', category: 'navegador', why: 'con aceleración por hardware compite por la gráfica', injects: false, closeable: true },
  brave: { label: 'Brave', category: 'navegador', why: 'con aceleración por hardware compite por la gráfica', injects: false, closeable: true },
  opera: { label: 'Opera', category: 'navegador', why: 'con aceleración por hardware compite por la gráfica', injects: false, closeable: true },

  discord: { label: 'Discord', category: 'comunicacion', why: 'su superposición se mete dentro del juego y cuesta fotogramas', injects: true, closeable: true },
  teams: { label: 'Microsoft Teams', category: 'comunicacion', why: 'consume bastante en segundo plano', injects: false, closeable: true },
  slack: { label: 'Slack', category: 'comunicacion', why: 'consume bastante en segundo plano', injects: false, closeable: true },

  obs64: { label: 'OBS Studio', category: 'captura', why: 'captura la pantalla enganchándose al juego', injects: true, closeable: true },
  obs32: { label: 'OBS Studio', category: 'captura', why: 'captura la pantalla enganchándose al juego', injects: true, closeable: true },
  rtss: { label: 'RivaTuner Statistics Server', category: 'captura', why: 'dibuja su contador dentro del juego', injects: true, closeable: true },
  rtsshooksloader64: { label: 'RivaTuner (cargador)', category: 'captura', why: 'engancha la tubería gráfica del juego', injects: true, closeable: true },
  msiafterburner: { label: 'MSI Afterburner', category: 'captura', why: 'su superposición se mete dentro del juego', injects: true, closeable: true },
  bandicam: { label: 'Bandicam', category: 'captura', why: 'captura enganchándose al juego', injects: true, closeable: true },
  fraps: { label: 'Fraps', category: 'captura', why: 'captura enganchándose al juego', injects: true, closeable: true },
  gamebar: { label: 'Barra de juegos de Xbox', category: 'captura', why: 'graba y superpone dentro del juego', injects: true, closeable: true },
  gamebarftserver: { label: 'Barra de juegos de Xbox', category: 'captura', why: 'graba y superpone dentro del juego', injects: true, closeable: true },
  nvcontainer: { label: 'NVIDIA (superposición y grabación)', category: 'captura', why: 'la superposición de NVIDIA se mete en el juego; el resto es del controlador', injects: true, closeable: false },

  icue: { label: 'Corsair iCUE', category: 'periféricos', why: 'los efectos de luces sondean el juego para reaccionar', injects: true, closeable: true },
  armourycrate: { label: 'Armoury Crate', category: 'periféricos', why: 'sondea el juego y consume bastante', injects: true, closeable: true },
  signalrgb: { label: 'SignalRGB', category: 'periféricos', why: 'se engancha al juego para sacar colores de la pantalla', injects: true, closeable: true },
  openrgb: { label: 'OpenRGB', category: 'periféricos', why: 'controla luces en segundo plano', injects: false, closeable: true },
  'razer synapse': { label: 'Razer Synapse', category: 'periféricos', why: 'sondea el juego para los efectos', injects: true, closeable: true },
  lghub: { label: 'Logitech G HUB', category: 'periféricos', why: 'sondea el juego para los efectos', injects: true, closeable: true },
  wallpaper64: { label: 'Wallpaper Engine', category: 'periféricos', why: 'anima el escritorio con la gráfica', injects: false, closeable: true },

  dropbox: { label: 'Dropbox', category: 'nube', why: 'sincroniza en segundo plano y castiga el disco', injects: false, closeable: true },
  onedrive: { label: 'OneDrive', category: 'nube', why: 'sincroniza en segundo plano y castiga el disco', injects: false, closeable: true },
  googledrivefs: { label: 'Google Drive', category: 'nube', why: 'sincroniza en segundo plano y castiga el disco', injects: false, closeable: true },

  epicgameslauncher: { label: 'Epic Games', category: 'tienda', why: 'puede estar descargando o actualizando', injects: false, closeable: true },
  upc: { label: 'Ubisoft Connect', category: 'tienda', why: 'puede estar descargando o actualizando', injects: false, closeable: true },
  eadesktop: { label: 'EA app', category: 'tienda', why: 'puede estar descargando o actualizando', injects: false, closeable: true },
  galaxyclient: { label: 'GOG Galaxy', category: 'tienda', why: 'puede estar descargando o actualizando', injects: false, closeable: true },
  battle: { label: 'Battle.net', category: 'tienda', why: 'puede estar descargando o actualizando', injects: false, closeable: true }
}

/** Nunca se propone cerrar nada de esto. */
const INTOCABLE =
  /^(system|idle|registry|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|explorer|fontdrvhost|sihost|ctfmon|audiodg|spoolsv|taskhostw|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|conhost|dllhost|wudfhost|memcompression|easyanticheat|beservice|bedaisy|vgc|vgtray|nvdisplay|nvidia web helper|amddvr|atieclxx|atiesrxx|radeonsoftware|steamservice|msmpeng|securityhealthservice|nissrv)/i

export const isUntouchable = (name: string): boolean => INTOCABLE.test(name)

function describe(name: string, company?: string): KnownApp | undefined {
  const n = name.toLowerCase().replace(/\.exe$/, '')
  if (CONOCIDOS[n]) return CONOCIDOS[n]
  for (const [clave, ficha] of Object.entries(CONOCIDOS)) {
    if (n.includes(clave)) return ficha
  }
  if (isUntouchable(n)) {
    return {
      label: name,
      category: 'sistema',
      why: 'forma parte de Windows, del controlador gráfico o de un anticheat',
      injects: false,
      closeable: false
    }
  }
  void company
  return undefined
}

async function powershell(script: string): Promise<string | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 20000 }
    )
    return stdout
  } catch {
    return null
  }
}

interface Muestra {
  Name: string
  Id: number
  WorkingSet64: number
  CPU: number | null
  Company: string | null
  Path: string | null
  MainWindowHandle: number
}

const SCRIPT_PROCESOS = `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-Process | Select-Object Name,Id,WorkingSet64,CPU,Company,Path,MainWindowHandle
ConvertTo-Json -Compress -Depth 2 -InputObject @($p)
`.trim()

async function muestra(): Promise<Muestra[]> {
  const salida = await powershell(SCRIPT_PROCESOS)
  if (!salida) return []
  try {
    const datos = JSON.parse(salida)
    return Array.isArray(datos) ? datos : [datos]
  } catch {
    return []
  }
}

/**
 * Dos muestras separadas en el tiempo para poder calcular el uso real de CPU.
 * Get-Process solo da segundos de procesador acumulados desde que arrancó el
 * programa; el porcentaje sale de la diferencia entre ambas.
 */
export async function listRunning(gapMs = 1500): Promise<RunningApp[]> {
  const antes = await muestra()
  if (!antes.length) return []
  await new Promise((r) => setTimeout(r, gapMs))
  const ahora = await muestra()

  const previo = new Map(antes.map((p) => [p.Id, p.CPU ?? 0]))
  const nucleos = Math.max(1, cpus().length)

  const apps: RunningApp[] = []
  for (const p of ahora) {
    const delta = (p.CPU ?? 0) - (previo.get(p.Id) ?? p.CPU ?? 0)
    const cpuPercent = Math.max(0, Math.round((delta / (gapMs / 1000) / nucleos) * 1000) / 10)
    const known = describe(p.Name, p.Company ?? undefined)
    apps.push({
      pid: p.Id,
      name: p.Name,
      label: known?.label ?? p.Name,
      company: p.Company ?? undefined,
      memoryBytes: p.WorkingSet64 ?? 0,
      cpuPercent,
      hasWindow: (p.MainWindowHandle ?? 0) !== 0,
      path: p.Path ?? undefined,
      known
    })
  }

  // Se agrupan los procesos de un mismo programa: un navegador son veinte.
  const agrupado = new Map<string, RunningApp>()
  for (const a of apps) {
    const clave = a.label
    const previo = agrupado.get(clave)
    if (!previo) {
      agrupado.set(clave, { ...a })
      continue
    }
    previo.memoryBytes += a.memoryBytes
    previo.cpuPercent = Math.round((previo.cpuPercent + a.cpuPercent) * 10) / 10
    previo.hasWindow = previo.hasWindow || a.hasWindow
    // El identificador que se guarda es el de la ventana principal, que es al
    // que tiene sentido pedirle que se cierre.
    if (!previo.hasWindow && a.hasWindow) previo.pid = a.pid
  }

  return [...agrupado.values()].sort((a, b) => {
    // Primero lo que se mete en el juego, luego lo que más CPU gasta.
    const ia = a.known?.injects ? 1 : 0
    const ib = b.known?.injects ? 1 : 0
    return ib - ia || b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes
  })
}

/**
 * DLL cargadas dentro del proceso del juego que no vienen ni del juego ni de
 * Windows. Es la versión en memoria de lo que VANTA hace con los archivos.
 */
export async function modulesOf(pid: number, gamePath: string): Promise<InjectedModule[] | null> {
  const salida = await powershell(`
$ErrorActionPreference = 'SilentlyContinue'
$m = (Get-Process -Id ${pid}).Modules | Select-Object -ExpandProperty FileName
ConvertTo-Json -Compress -InputObject @($m)
  `.trim())
  if (!salida) return null
  let rutas: string[]
  try {
    const datos = JSON.parse(salida)
    rutas = (Array.isArray(datos) ? datos : [datos]).filter((x) => typeof x === 'string')
  } catch {
    return null
  }
  if (!rutas.length) return null

  const juego = path.resolve(gamePath).toLowerCase()
  const windows = (process.env.SystemRoot ?? 'C:\\Windows').toLowerCase()

  return rutas.map((file) => {
    const bajo = file.toLowerCase()
    const origin: InjectedModule['origin'] = bajo.startsWith(juego)
      ? 'juego'
      : bajo.startsWith(windows)
        ? 'windows'
        : 'ajeno'
    return { file, name: path.basename(file), origin }
  })
}

/** Encuentra el proceso del juego por el nombre de su ejecutable. */
export async function findGameProcess(exeName: string): Promise<number | null> {
  const base = path.basename(exeName).replace(/\.exe$/i, '')
  const salida = await powershell(`
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-Process -Name '${base.replace(/'/g, "''")}' | Select-Object -First 1 -ExpandProperty Id
ConvertTo-Json -Compress -InputObject @($p)
  `.trim())
  if (!salida) return null
  try {
    const datos = JSON.parse(salida)
    const id = Array.isArray(datos) ? datos[0] : datos
    return typeof id === 'number' ? id : null
  } catch {
    return null
  }
}

/**
 * Pide a la ventana que se cierre, como si le dieras a la equis. Nunca mata el
 * proceso: si el programa tiene algo sin guardar, podrá preguntártelo.
 */
export async function closeApp(pid: number, name: string): Promise<{ ok: boolean; error?: string }> {
  if (isUntouchable(name)) {
    return { ok: false, error: 'Ese proceso es del sistema y VANTA no lo toca.' }
  }
  const salida = await powershell(`
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-Process -Id ${pid}
if (-not $p) { 'nohay' } elseif ($p.CloseMainWindow()) { 'ok' } else { 'sinventana' }
  `.trim())
  const r = (salida ?? '').trim()
  if (r === 'ok') return { ok: true }
  if (r === 'nohay') return { ok: false, error: 'Ese programa ya no está abierto.' }
  return {
    ok: false,
    error: 'No tiene ventana que cerrar. Ciérralo desde su icono junto al reloj.'
  }
}
