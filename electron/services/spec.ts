/**
 * Deduce qué es un juego a partir de sus archivos: motor, API gráfica,
 * anticheat y DLL que ya se hayan colado en la raíz.
 */

import path from 'node:path'
import type { ApiFinding, Confidence, GameSpec, GraphicsApi, PeInfo } from '../../shared/types'
import { readPe } from './pe'

/** Ejecutables que acompañan a los juegos pero no son el juego. */
const NOT_THE_GAME =
  /(unitycrashhandler|unrealcefsubprocess|crashreportclient|crashpad|easyanticheat|battleye|be_?service|vcredist|vc_redist|dxsetup|dotnetfx|oalinst|directx|unins|uninstall|setup|installer|launcher_installer|python|ffmpeg|7z|dxwebsetup|nvngx|touchup)/i

const ENGINE_RULES: { name: string; test: (files: Set<string>, list: string[]) => string | null }[] = [
  {
    name: 'Unity',
    test: (f, l) =>
      f.has('unityplayer.dll') || l.some((p) => p.endsWith('_data/globalgamemanagers'))
        ? 'UnityPlayer.dll y carpeta *_Data'
        : null
  },
  {
    name: 'Unreal Engine',
    test: (_f, l) =>
      l.some((p) => /binaries\/win64\/.*-(shipping|win64-shipping)\.exe$/.test(p)) ||
      l.some((p) => p.startsWith('engine/binaries/'))
        ? 'ejecutable -Shipping.exe y carpeta Engine\\Binaries'
        : null
  },
  {
    name: 'Creation Engine',
    test: (_f, l) =>
      l.some((p) => /^data\/.*\.esm$/.test(p)) && l.some((p) => /\.bsa$/.test(p))
        ? 'archivos .esm y .bsa en Data'
        : null
  },
  {
    name: 'RE Engine',
    test: (f) => (f.has('re_chunk_000.pak') ? 're_chunk_000.pak' : null)
  },
  {
    name: 'REDengine',
    test: (_f, l) => (l.some((p) => /^archive\/pc\/content\/.*\.archive$/.test(p)) ? 'archivos .archive en archive\\pc' : null)
  },
  {
    name: 'Decima',
    test: (_f, l) =>
      l.some((p) => /^packed_dx12\//.test(p)) || l.some((p) => /\.core$/.test(p) && l.length > 100)
        ? 'archivos .core y carpeta Packed_DX12'
        : null
  },
  {
    name: 'id Tech',
    test: (_f, l) => (l.some((p) => /^base\/.*\.resources$/.test(p)) ? 'archivos .resources en base' : null)
  },
  {
    name: 'Source',
    test: (_f, l) => (l.some((p) => /^bin\/(engine|tier0)\.dll$/.test(p)) ? 'engine.dll en bin' : null)
  },
  {
    name: 'CryEngine',
    test: (_f, l) => (l.some((p) => /^engine\/engine\.pak$/.test(p) || /cryengine.*\.dll$/.test(p)) ? 'engine.pak de CryEngine' : null)
  },
  {
    name: 'Frostbite',
    test: (_f, l) => (l.some((p) => /^data\/win32\//.test(p)) ? 'estructura Data\\Win32' : null)
  },
  {
    name: 'Anvil',
    test: (_f, l) => (l.some((p) => /^datapc.*\.forge$/.test(p)) ? 'archivos .forge' : null)
  },
  {
    name: 'CATHODE',
    test: (_f, l) =>
      l.some((p) => /^data\/.*\.bml$/.test(p)) && l.some((p) => /^data\/.*\.pak$/.test(p))
        ? 'archivos .BML y .PAK en DATA'
        : null
  },
  {
    name: 'Dunia',
    test: (_f, l) => (l.some((p) => /^data_win(32|64)\/.*\.fat$/.test(p)) ? 'archivos .fat en data_win' : null)
  },
  {
    name: 'Snowdrop',
    test: (_f, l) => (l.some((p) => /\.sdfdata$/.test(p)) ? 'archivos .sdfdata' : null)
  },
  {
    name: 'Godot',
    test: (_f, l) => (l.some((p) => /\.pck$/.test(p)) && l.length < 200 ? 'archivo .pck' : null)
  }
]

const ANTICHEAT_RULES: { name: string; match: RegExp }[] = [
  { name: 'Easy Anti-Cheat', match: /(^|\/)easyanticheat(_x64)?\.(sys|dll|exe)$|^easyanticheat\// },
  { name: 'BattlEye', match: /(^|\/)be(client|service)_x64\.dll$|^battleye\// },
  { name: 'nProtect GameGuard', match: /(^|\/)gameguard/ },
  { name: 'Denuvo Anti-Cheat', match: /denuvo.*anti.?cheat/ },
  { name: 'Ricochet', match: /(^|\/)ricochet/ }
]

/** DLL cuyo nombre coincide con una API: si están sueltas en la raíz, alguien las ha puesto ahí. */
const PROXY_TARGETS: Record<string, string> = {
  'dxgi.dll': 'DXGI (DX11/DX12)',
  'd3d9.dll': 'Direct3D 9',
  'd3d10.dll': 'Direct3D 10',
  'd3d11.dll': 'Direct3D 11',
  'd3d12.dll': 'Direct3D 12',
  'opengl32.dll': 'OpenGL',
  'dinput8.dll': 'DirectInput 8',
  'winmm.dll': 'Windows Multimedia',
  'version.dll': 'Version API',
  'xinput1_3.dll': 'XInput',
  'wininet.dll': 'WinINet'
}

function addApi(
  map: Map<GraphicsApi, ApiFinding>,
  api: GraphicsApi,
  confidence: Confidence,
  evidence: string
): void {
  const rank: Record<Confidence, number> = { baja: 0, media: 1, alta: 2 }
  const found = map.get(api)
  if (!found) {
    map.set(api, { api, confidence, evidence: [evidence] })
    return
  }
  if (!found.evidence.includes(evidence)) found.evidence.push(evidence)
  if (rank[confidence] > rank[found.confidence]) found.confidence = confidence
}

function pickMainExecutable(list: string[], gameName: string): string | undefined {
  const exes = list.filter((p) => p.endsWith('.exe') && !NOT_THE_GAME.test(p))
  if (!exes.length) return undefined
  const slug = gameName.toLowerCase().replace(/[^a-z0-9]/g, '')
  const score = (p: string): number => {
    const base = path.posix.basename(p, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '')
    let s = 0
    if (slug && (base.includes(slug) || slug.includes(base))) s += 60
    if (/-shipping$/i.test(base)) s += 50
    if (!p.includes('/')) s += 30
    if (/binaries\/win64\//.test(p)) s += 25
    if (/(x64|win64)/.test(base)) s += 5
    s -= p.split('/').length * 2
    return s
  }
  return exes.sort((a, b) => score(b) - score(a))[0]
}

export interface SpecInput {
  gameName: string
  gamePath: string
  /** Rutas relativas a la raíz del juego, tal cual están en disco, con barras normales. */
  relPaths: string[]
}

export async function buildSpec(input: SpecInput): Promise<GameSpec> {
  // Las comparaciones van en minúsculas, pero el acceso al disco usa la ruta
  // real: Windows no distingue mayúsculas, pero el escaneo sí las conserva.
  const list = input.relPaths.map((p) => p.toLowerCase())
  const original = new Map<string, string>()
  for (const p of input.relPaths) original.set(p.toLowerCase(), p)
  const onDisk = (rel: string): string =>
    path.join(input.gamePath, (original.get(rel) ?? rel).split('/').join(path.sep))

  const rootFiles = new Set(list.filter((p) => !p.includes('/')))
  const names = new Set(list.map((p) => path.posix.basename(p)))

  // --- Motor ---
  let engine = 'no identificado'
  const engineEvidence: string[] = []
  for (const rule of ENGINE_RULES) {
    const hit = rule.test(names, list)
    if (hit) {
      engine = rule.name
      engineEvidence.push(hit)
      break
    }
  }

  // --- Ejecutable principal y su cabecera ---
  const mainExecutableLower = pickMainExecutable(list, input.gameName)
  const mainExecutable = mainExecutableLower
    ? (original.get(mainExecutableLower) ?? mainExecutableLower)
    : undefined
  let mainPe: PeInfo | null = null
  if (mainExecutableLower) {
    mainPe = await readPe(onDisk(mainExecutableLower), { deepScan: true })
  }

  // --- API gráfica ---
  const apis = new Map<GraphicsApi, ApiFinding>()
  const IMPORT_MAP: Record<string, GraphicsApi> = {
    'd3d9.dll': 'dx9',
    'd3d10.dll': 'dx10',
    'd3d11.dll': 'dx11',
    'd3d12.dll': 'dx12',
    'vulkan-1.dll': 'vulkan',
    'opengl32.dll': 'opengl'
  }
  for (const imp of mainPe?.imports ?? []) {
    const api = IMPORT_MAP[imp]
    if (api) addApi(apis, api, 'alta', `el ejecutable importa ${imp}`)
    if (imp === 'dxgi.dll' && !apis.has('dx11') && !apis.has('dx12')) {
      addApi(apis, 'dx11', 'baja', 'el ejecutable importa dxgi.dll, que usan DX11 y DX12')
    }
  }
  const HINT_MAP: Record<string, GraphicsApi> = {
    D3D12CreateDevice: 'dx12',
    'd3d12.dll': 'dx12',
    D3D11CreateDevice: 'dx11',
    'd3d11.dll': 'dx11',
    Direct3DCreate9: 'dx9',
    'd3d9.dll': 'dx9',
    vkCreateInstance: 'vulkan',
    'vulkan-1.dll': 'vulkan',
    wglCreateContext: 'opengl',
    'opengl32.dll': 'opengl'
  }
  for (const hint of mainPe?.dynamicHints ?? []) {
    const api = HINT_MAP[hint]
    if (api) addApi(apis, api, 'media', `el ejecutable contiene la cadena ${hint} (carga dinámica)`)
  }

  if (names.has('d3dcompiler_43.dll') || [...names].some((n) => /^d3dx9_\d+\.dll$/.test(n))) {
    addApi(apis, 'dx9', 'baja', 'incluye runtime de la época de DX9 (d3dx9)')
  }
  if (names.has('dxcompiler.dll') || names.has('dxil.dll')) {
    addApi(apis, 'dx12', 'baja', 'incluye el compilador de shaders de DX12')
  }
  if (names.has('vulkan-1.dll')) addApi(apis, 'vulkan', 'baja', 'incluye vulkan-1.dll')
  if (list.some((p) => /shadercache\/dx12|\/dx12\//.test(p))) {
    addApi(apis, 'dx12', 'baja', 'tiene carpetas de shaders de DX12')
  }

  // --- Anticheat ---
  const antiCheat = ANTICHEAT_RULES.filter((r) => list.some((p) => r.match.test(p))).map((r) => ({
    name: r.name,
    evidence: 'archivos propios del sistema en la carpeta del juego'
  }))

  // --- DLL proxy en la raíz ---
  const proxyDlls: GameSpec['proxyDlls'] = []
  for (const file of rootFiles) {
    const hijacks = PROXY_TARGETS[file]
    if (!hijacks) continue
    const pe = await readPe(onDisk(file))
    const label = [pe?.productName, pe?.fileDescription, pe?.companyName]
      .filter(Boolean)
      .join(' · ')
    proxyDlls.push({ file: original.get(file) ?? file, hijacks, identifiedAs: label || undefined })
  }

  // --- Redistribuibles ---
  const redistributables = [...new Set(
    list
      .filter((p) => /^_commonredist\/([^/]+)\//.test(p))
      .map((p) => (original.get(p) ?? p).split('/')[1])
  )]

  const order: GraphicsApi[] = ['dx12', 'vulkan', 'dx11', 'dx10', 'dx9', 'opengl']
  const rank: Record<Confidence, number> = { alta: 0, media: 1, baja: 2 }

  return {
    engine,
    engineEvidence,
    apis: [...apis.values()].sort(
      (a, b) => rank[a.confidence] - rank[b.confidence] || order.indexOf(a.api) - order.indexOf(b.api)
    ),
    arch: mainPe?.arch ?? 'desconocida',
    mainExecutable,
    mainExecutablePe: mainPe ?? undefined,
    antiCheat,
    proxyDlls,
    redistributables
  }
}
