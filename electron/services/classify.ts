/**
 * Catálogo de firmas conocidas.
 *
 * Una firma identifica un conjunto de archivos como una cosa concreta:
 * ReShade, ENB, DXVK, un cargador de mods... Se comprueba por tres vías, de
 * más fiable a menos:
 *
 *   1. Datos de versión del binario (VERSIONINFO). Una DLL de ReShade dice
 *      literalmente que es ReShade. Es la prueba más limpia que existe.
 *   2. Archivos característicos con nombre inequívoco (ReShade.ini, dxvk.conf).
 *   3. Patrones de ruta (carpetas reshade-shaders, ~mods, etc.).
 *
 * Lo que no encaje en ninguna se agrupa por lote y te lo pregunta.
 */

import path from 'node:path'
import { open } from 'node:fs/promises'
import type { Category, ChangeEntry, FileGroup, LearnedRule } from '../../shared/types'
import { readPe } from './pe'

export const CATEGORY_LABEL: Record<Category, string> = {
  postproceso: 'Post-procesado',
  'traduccion-api': 'Traducción de API',
  cargador: 'Cargador o inyector',
  contenido: 'Mod de contenido',
  herramienta: 'Herramienta',
  gestor: 'Gestor de mods',
  configuracion: 'Configuración',
  respaldo: 'Respaldo de un original',
  partida: 'Partida guardada',
  ausente: 'Original que falta',
  desconocido: 'Sin identificar'
}

export interface Signature {
  id: string
  name: string
  category: Category
  /** Patrones sobre la ruta relativa en minúsculas. */
  paths?: RegExp[]
  /** Texto que debe aparecer en los datos de versión del binario. */
  versionInfo?: RegExp
  /**
   * DLL del sistema que este programa suplanta para cargarse. Si sus archivos
   * característicos están presentes y hay una DLL con ese nombre en la raíz
   * sin identificar, se le atribuye aunque no lleve datos de versión.
   */
  claimsProxy?: RegExp
}

export const SIGNATURES: Signature[] = [
  // --- post-procesado ---
  {
    id: 'reshade',
    claimsProxy: /^(dxgi|d3d9|d3d10|d3d11|d3d12|opengl32|ddraw)\.dll$/,
    name: 'ReShade',
    category: 'postproceso',
    paths: [
      /^reshade[^/]*\.(ini|log|json)$/,
      /^reshade-shaders\//,
      /^reshade_?presets?\//,
      /^[^/]*reshadepreset[^/]*\.ini$/,
      /\.addon(64)?$/
    ],
    versionInfo: /reshade|crosire/i
  },
  {
    id: 'enb',
    claimsProxy: /^(d3d9|d3d11|dxgi)\.dll$/,
    name: 'ENBSeries',
    category: 'postproceso',
    paths: [/^enb(local|series|host|adaptation)?\.ini$/, /^enbseries\//, /^enbcache\//],
    versionInfo: /enbseries|boris vorontsov/i
  },
  {
    id: 'sweetfx',
    name: 'SweetFX',
    category: 'postproceso',
    paths: [/^sweetfx/, /^sweet\.fx$/]
  },

  // --- traducción de API ---
  {
    id: 'dxvk',
    claimsProxy: /^(d3d9|d3d10|d3d11|dxgi)\.dll$/,
    name: 'DXVK',
    category: 'traduccion-api',
    paths: [/^dxvk\.(conf|log|cache)$/, /^[^/]*\.dxvk-cache$/],
    versionInfo: /dxvk/i
  },
  {
    id: 'vkd3d',
    name: 'VKD3D-Proton',
    category: 'traduccion-api',
    paths: [/^vkd3d/],
    versionInfo: /vkd3d/i
  },
  {
    id: 'dgvoodoo',
    name: 'dgVoodoo',
    category: 'traduccion-api',
    paths: [/^dgvoodoo\.conf$/, /^dgvoodoocpl\.exe$/],
    versionInfo: /dgvoodoo/i
  },

  // --- cargadores e inyectores ---
  {
    id: 'specialk',
    claimsProxy: /^(dxgi|d3d9|d3d11|d3d12|dinput8|opengl32)\.dll$/,
    name: 'Special K',
    category: 'cargador',
    paths: [/^specialk/, /^sk_res\//, /^dxgi\.log$/],
    versionInfo: /special ?k/i
  },
  {
    id: 'asiloader',
    claimsProxy: /^(dinput8|winmm|version|xinput1_[34]|dsound|wininet)\.dll$/,
    name: 'Ultimate ASI Loader',
    category: 'cargador',
    paths: [/\.asi$/, /^scripts\/.*\.asi$/],
    versionInfo: /ultimate asi loader|thirteenag/i
  },
  {
    id: 'scriptextender',
    name: 'Script Extender',
    category: 'cargador',
    paths: [/^(sk|f4|nv|ob|sf|xb)se(64)?(_loader)?\.(exe|dll)$/, /^(sk|f4|nv|sf)se[^/]*\.(dll|exe|log)$/]
  },
  {
    id: 'bepinex',
    claimsProxy: /^winhttp\.dll$/,
    name: 'BepInEx',
    category: 'cargador',
    paths: [/^bepinex\//, /^doorstop_config\.ini$/, /^\.doorstop_version$/],
    versionInfo: /bepinex|doorstop/i
  },
  {
    id: 'melonloader',
    claimsProxy: /^version\.dll$/,
    name: 'MelonLoader',
    category: 'cargador',
    paths: [/^melonloader\//],
    versionInfo: /melonloader/i
  },
  {
    id: 'red4ext',
    claimsProxy: /^version\.dll$/,
    name: 'RED4ext / CET',
    category: 'cargador',
    paths: [/^red4ext\//, /^bin\/x64\/plugins\//, /^r6\/scripts\//],
    versionInfo: /red4ext|cyber engine tweaks/i
  },

  // --- escalado y generación de fotogramas ---
  {
    id: 'dlss',
    name: 'DLSS sustituido',
    category: 'herramienta',
    paths: [/^nvngx_dlss[^/]*\.dll$/, /^nvngx\.dll$/],
    versionInfo: /nvidia.*dlss|ngx/i
  },
  {
    id: 'fsr3',
    name: 'FSR / generación de fotogramas',
    category: 'herramienta',
    paths: [/^dlssg[_-]to[_-]fsr3/, /^amd_fidelityfx/, /^ffx_/, /^optiscaler/, /^libxess\.dll$/],
    versionInfo: /fidelityfx|optiscaler|xess/i
  },

  // --- gestores de mods ---
  {
    id: 'vortex',
    name: 'Vortex',
    category: 'gestor',
    paths: [/^vortex\.deployment\.json$/, /^__vortex_staging_folder$/, /vortex\.deployment/]
  },
  {
    id: 'mo2',
    name: 'Mod Organizer 2',
    category: 'gestor',
    paths: [/^modorganizer\.ini$/, /^usvfs[^/]*\.dll$/, /^modorganizer/],
    versionInfo: /mod organizer|usvfs/i
  },

  {
    id: 'reframework',
    name: 'REFramework',
    category: 'cargador',
    paths: [
      /^re2_fw_config\.txt$/,
      /^re2_framework_log\.txt$/,
      /^reframework_[a-z_]+\.txt$/,
      /^ref_ui\.ini$/,
      /^reframework\//,
      /^csharp-api\//,
      /^reframework[^/]*\.(dll|zip)$/
    ],
    versionInfo: /reframework|praydog/i,
    claimsProxy: /^dinput8\.dll$/
  },

  // --- contenido ---
  {
    id: 'bethesda-plugin',
    name: 'Mods de Data (esp/esl/ba2)',
    category: 'contenido',
    paths: [/^data\/[^/]+\.(esp|esl|ba2)$/]
  },
  {
    id: 'unreal-pak',
    name: 'Mods en Paks',
    category: 'contenido',
    paths: [/\/paks\/(~mods|mods|logicmods)\//, /\/paks\/[^/]*_p\.pak$/]
  },
  {
    id: 'bepinex-plugin',
    name: 'Plugins de BepInEx',
    category: 'contenido',
    paths: [/^bepinex\/plugins\//]
  },
  {
    id: 'mods-folder',
    name: 'Contenido en la carpeta mods',
    category: 'contenido',
    paths: [/^mods\//]
  },

  // --- herramientas ---
  {
    id: 'renderdoc',
    name: 'RenderDoc',
    category: 'herramienta',
    paths: [/^renderdoc/],
    versionInfo: /renderdoc/i
  },
  {
    id: 'cheatengine',
    name: 'Cheat Engine o entrenador',
    category: 'herramienta',
    paths: [/cheatengine/, /\.ct$/, /trainer/]
  },
  {
    id: 'crashlogs',
    name: 'Registros y volcados',
    category: 'herramienta',
    paths: [/\.(log|dmp|mdmp)$/, /^logs?\//, /^crashes?\//]
  },
  {
    // Muchos juegos escriben cachés de shaders o materiales al arrancar, en
    // carpetas llamadas cache y con extensión .tmp. No son mods: los regenera
    // el propio juego y se pueden purgar sin consecuencias.
    id: 'gamecache',
    name: 'Caché generada por el juego',
    category: 'herramienta',
    paths: [/(^|\/)(cache|shadercache|shader_cache|__cache|pipelinecache)\//, /\.(tmp|temp|cache)$/]
  },
  {
    // Copias con sufijo de respaldo cuyo contenido no coincide con ningún
    // original conocido. Las que sí coinciden van al grupo de respaldos por
    // huella, que se comprueba antes que esta regla.
    id: 'bak',
    name: 'Copias .bak sin verificar',
    category: 'herramienta',
    paths: [/\.(bak|old|orig|backup|original|vanilla)$/]
  }
]

/** DLL del sistema que se pueden suplantar para inyectar código en el juego. */
const PROXY_NAMES =
  /^(dxgi|d3d9|d3d10|d3d11|d3d12|ddraw|opengl32|dinput8|dinput|winmm|version|winhttp|wininet|xinput1_[34]|dsound|xlive)\.dll$/

/** Marcas inequívocas de un preajuste de ReShade dentro de un .ini suelto. */
const RESHADE_PRESET = /(^|\n)\s*(Techniques|TechniqueSorting|PreprocessorDefinitions)\s*=/i

async function looksLikeReshadePreset(abs: string, size: number): Promise<boolean> {
  if (size > 1024 * 1024) return false
  try {
    const fh = await open(abs, 'r')
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(buf, 0, 4096, 0)
    await fh.close()
    return RESHADE_PRESET.test(buf.subarray(0, bytesRead).toString('latin1'))
  } catch {
    return false
  }
}

const CONFIG_EXT = /\.(ini|cfg|conf|xml|json|toml|yaml|yml|settings|prefs|properties)$/i
const SAVE_EXT = /\.(sav|save|savegame|savedata|ess|fos|sl2|slot)$/i
const SAVE_DIR = /(^|\/)(saves?|savegames?|savedata|savefiles|storage|slots?)\//i

export interface ClassifyInput {
  entries: ChangeEntry[]
  /** Rutas absolutas de cada raíz, por índice. */
  roots: string[]
  /** Índices de raíz protegidas (partidas, marcadas por el usuario). */
  protectedRoots: Set<number>
  learned: LearnedRule[]
  /** Archivos desplegados por Vortex, con el mod del que salió cada uno. */
  deployed?: Map<string, string>
  gameId: string
  /** Etiqueta del lote para lo que no se identifique. */
  batchLabel: string
}

interface Bucket {
  name: string
  category: Category
  kind: FileGroup['kind']
  detectedBy?: string
  locked: boolean
  entries: ChangeEntry[]
}

function matchSignature(rel: string): Signature | null {
  for (const sig of SIGNATURES) {
    if (sig.paths?.some((rx) => rx.test(rel))) return sig
  }
  return null
}

/** Segunda pasada: mirar dentro de los binarios que no encajaron por ruta. */
async function matchByVersionInfo(
  abs: string
): Promise<{ sig: Signature | null; identity?: string }> {
  const pe = await readPe(abs)
  if (!pe) return { sig: null }
  const identity = [pe.productName, pe.fileDescription, pe.companyName].filter(Boolean).join(' · ')
  if (!identity) return { sig: null }
  for (const sig of SIGNATURES) {
    if (sig.versionInfo?.test(identity)) return { sig, identity }
  }
  return { sig: null, identity }
}

export async function classify(input: ClassifyInput): Promise<{
  entries: ChangeEntry[]
  groups: FileGroup[]
}> {
  const buckets = new Map<string, Bucket>()
  const put = (id: string, seed: Omit<Bucket, 'entries'>, entry: ChangeEntry): void => {
    let b = buckets.get(id)
    if (!b) {
      b = { ...seed, entries: [] }
      buckets.set(id, b)
    }
    b.entries.push(entry)
    entry.groupId = id
  }

  const learnedForGame = input.learned.filter((r) => r.gameId === null || r.gameId === input.gameId)

  for (const entry of input.entries) {
    const rel = entry.rel.toLowerCase()
    const abs = path.join(input.roots[entry.root] ?? '', entry.rel.split('/').join(path.sep))

    // 1. Protegidos: partidas y raíces marcadas. Nunca se tocan.
    if (input.protectedRoots.has(entry.root) || SAVE_EXT.test(rel) || SAVE_DIR.test(rel)) {
      put('partidas', {
        name: 'Partidas guardadas y datos de usuario',
        category: 'partida',
        kind: 'firma',
        detectedBy: 'ruta o extensión de partida',
        locked: true
      }, entry)
      continue
    }

    // 2. Emparejado por huella. Si el contenido coincide bit a bit con un
    //    original, no es un archivo ajeno: es ese original con otro nombre.
    if (entry.pairedWith) {
      const renamed = entry.pairedWith.kind !== 'copia-de'
      put(renamed ? 'respaldo-renombrado' : 'respaldo-copia', {
        name: renamed
          ? 'Originales desactivados renombrando'
          : 'Copias de seguridad de originales',
        category: 'respaldo',
        kind: 'firma',
        detectedBy: renamed
          ? 'la huella coincide con un original que ha desaparecido'
          : 'la huella coincide con un original que sigue en su sitio',
        // Renombrar no destruye nada, pero purgar el renombrado sí borraría el
        // único ejemplar del original. Se deshace, no se purga.
        locked: renamed
      }, entry)
      continue
    }

    // 3. Lo que estaba en la línea base y ya no está. No se puede purgar lo
    //    que no existe, y agruparlo con los mods ensuciaría el recuento.
    if (entry.status === 'desaparecido') {
      put('ausentes', {
        name: 'Originales que faltan',
        category: 'ausente',
        kind: 'firma',
        detectedBy: 'estaba en la línea base y ha desaparecido',
        locked: true
      }, entry)
      continue
    }

    // 4. Lo que Vortex dice que ha puesto él. No hay que adivinar: viene
    //    firmado en su propio manifiesto de despliegue.
    const mod = input.deployed?.get(rel)
    if (mod) {
      put(`vortex:${mod}`, {
        name: `Vortex · ${mod}`,
        category: 'contenido',
        kind: 'firma',
        detectedBy: 'consta en el manifiesto de despliegue de Vortex',
        locked: false
      }, entry)
      continue
    }

    // 5. Reglas que aprendió de ti.
    const learned = learnedForGame.find((r) =>
      r.pattern.endsWith('/') ? rel.startsWith(r.pattern) : rel === r.pattern
    )
    if (learned) {
      put(`aprendida:${learned.id}`, {
        name: learned.name,
        category: learned.category,
        kind: 'manual',
        detectedBy: 'lo nombraste tú',
        locked: false
      }, entry)
      continue
    }

    // 6. Firmas conocidas por ruta.
    const sig = matchSignature(rel)
    if (sig) {
      put(`firma:${sig.id}`, {
        name: sig.name,
        category: sig.category,
        kind: 'firma',
        detectedBy: 'archivo característico',
        locked: false
      }, entry)
      continue
    }

    // 7. Firmas por datos de versión del binario.
    if (/\.(dll|exe|asi|node)$/i.test(rel)) {
      const { sig: bySig, identity } = await matchByVersionInfo(abs)
      if (identity) entry.identity = identity
      if (bySig) {
        put(`firma:${bySig.id}`, {
          name: bySig.name,
          category: bySig.category,
          kind: 'firma',
          detectedBy: 'datos de versión del binario',
          locked: false
        }, entry)
        continue
      }
    }

    // 8. Una DLL suelta en la raíz con nombre de librería del sistema es un
    //    inyector, aunque no sepamos de quién. Merece su propio aviso.
    if (PROXY_NAMES.test(rel)) {
      put('proxy-dll', {
        name: 'DLL proxy sin identificar',
        category: 'cargador',
        kind: 'firma',
        detectedBy: 'suplanta a una librería del sistema desde la raíz del juego',
        locked: false
      }, entry)
      continue
    }

    // 9. Un .ini suelto puede ser un preajuste de ReShade con nombre libre.
    //    No hay firma posible en la ruta, así que se mira el contenido.
    if (/\.(ini|txt)$/i.test(rel) && entry.status === 'nuevo') {
      if (await looksLikeReshadePreset(abs, entry.size)) {
        put('firma:reshade', {
          name: 'ReShade',
          category: 'postproceso',
          kind: 'firma',
          detectedBy: 'contenido de preajuste de ReShade',
          locked: false
        }, entry)
        continue
      }
    }

    // 10. Configuración modificada: se separa porque casi siempre la reescribe
    //    el propio juego, y borrarla no arregla nada.
    if (CONFIG_EXT.test(rel) && entry.status === 'modificado') {
      put('config', {
        name: 'Configuración modificada',
        category: 'configuracion',
        kind: 'firma',
        detectedBy: 'archivo de ajustes que ha cambiado',
        locked: false
      }, entry)
      continue
    }

    // 11. Lo demás, al lote de esta revisión.
    put('lote', {
      name: `Sin identificar · ${input.batchLabel}`,
      category: 'desconocido',
      kind: 'lote',
      detectedBy: 'apareció desde la última revisión',
      locked: false
    }, entry)
  }

  // Una DLL proxy sin datos de versión no dice de quién es, pero sus vecinos
  // sí: si los archivos característicos de un programa están ahí y ese
  // programa se carga precisamente por esa DLL, es suya.
  const orphanProxies = buckets.get('proxy-dll')
  if (orphanProxies) {
    for (const sig of SIGNATURES) {
      if (!sig.claimsProxy) continue
      const owner = buckets.get(`firma:${sig.id}`)
      if (!owner) continue
      // Solo las mudas. Una DLL que declara ser otra cosa no se reatribuye.
      const claimed = orphanProxies.entries.filter(
        (e) => !e.identity && sig.claimsProxy!.test(e.rel.toLowerCase())
      )
      for (const entry of claimed) {
        entry.groupId = `firma:${sig.id}`
        owner.entries.push(entry)
      }
      orphanProxies.entries = orphanProxies.entries.filter((e) => !claimed.includes(e))
    }
    if (!orphanProxies.entries.length) buckets.delete('proxy-dll')
  }

  const groups: FileGroup[] = [...buckets.entries()].map(([id, b]) => ({
    id,
    name: b.name,
    category: b.category,
    kind: b.kind,
    detectedBy: b.detectedBy,
    fileCount: b.entries.length,
    totalBytes: b.entries.reduce((n, e) => n + e.size, 0),
    counts: {
      nuevo: b.entries.filter((e) => e.status === 'nuevo').length,
      modificado: b.entries.filter((e) => e.status === 'modificado').length,
      desaparecido: b.entries.filter((e) => e.status === 'desaparecido').length
    },
    locked: b.locked
  }))

  const order: Category[] = [
    'desconocido',
    'postproceso',
    'traduccion-api',
    'cargador',
    'contenido',
    'gestor',
    'herramienta',
    'configuracion',
    'respaldo',
    'ausente',
    'partida'
  ]
  groups.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || b.fileCount - a.fileCount)

  return { entries: input.entries, groups }
}

/**
 * Convierte un grupo nombrado a mano en reglas reutilizables.
 *
 * Una regla es o bien una carpeta (termina en barra, vale para todo lo que
 * cuelgue de ella) o bien un archivo exacto. Para grupos pequeños se aprenden
 * los archivos uno a uno; para grandes, sus carpetas inmediatas. Nunca la
 * carpeta de primer nivel: aprender "data/" por un solo archivo en
 * data/cache/ se comería medio juego en la siguiente revisión.
 */
export function deriveRules(
  members: ChangeEntry[],
  allEntries: ChangeEntry[],
  name: string,
  category: Category,
  gameId: string | null
): LearnedRule[] {
  const alive = members.filter((e) => e.status !== 'desaparecido')
  const mine = new Set(alive.map((e) => e.rel.toLowerCase()))
  const others = allEntries
    .filter((e) => e.status !== 'desaparecido' && !mine.has(e.rel.toLowerCase()))
    .map((e) => e.rel.toLowerCase())

  // Para cada archivo se busca la carpeta más corta que no contenga nada de
  // otros grupos. Así "TexturasHD/" vale como regla si es toda del mod, pero
  // "Data/" no, porque ahí hay archivos de todo el mundo: en ese caso la regla
  // es el archivo exacto y no se traga nada ajeno.
  const patterns = new Set<string>()
  for (const rel of mine) {
    const parts = rel.split('/')
    let chosen = rel
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join('/') + '/'
      if (!others.some((o) => o.startsWith(folder))) {
        chosen = folder
        break
      }
    }
    patterns.add(chosen)
  }

  const now = new Date().toISOString()
  return [...patterns].map((pattern) => ({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    gameId,
    pattern,
    name,
    category,
    createdAt: now
  }))
}
