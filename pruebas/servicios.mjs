/**
 * Pruebas de los servicios de VANTA.
 *
 * Monta juegos simulados en una carpeta temporal y recorre todo lo que hace
 * VANTA sin necesidad de Electron ni de Windows: análisis de binarios, línea
 * base, comparación, clasificación, cuarentena, perfiles, configuraciones,
 * carátulas e informes. Si algo se rompe al cambiar código, salta aquí.
 *
 * Ejecutar con:  node pruebas/servicios.mjs   (o con PROBAR.bat)
 */

import { build } from 'esbuild'
import { mkdir, writeFile, readFile, copyFile, rename, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(tmpdir(), `vanta-pruebas-${process.pid}`)
const OUT = path.join(TMP, 'bundle')

let passed = 0
let failed = 0
const ok = (label, cond) => {
  if (cond) passed++
  else failed++
  console.log(`${cond ? '   ok ' : ' FALLO'}  ${label}`)
}
const title = (t) => console.log(`\n== ${t}`)

// ---------------------------------------------------------------- montaje

await rm(TMP, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const services = [
  'scan', 'diff', 'classify', 'quarantine', 'originals', 'profiles', 'vortex',
  'report', 'config', 'configStore', 'registry', 'art', 'pe', 'detect', 'spec',
  'timeline', 'inspect', 'watch', 'processes', 'hashWorker'
]
await build({
  entryPoints: services.map((s) => path.join(ROOT, 'electron', 'services', `${s}.ts`)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: OUT,
  logLevel: 'error'
})

// El resolutor de carátulas pregunta al registro dónde está Steam. Aquí no hay
// registro: se le apunta a una carpeta de prueba reescribiendo esa función.
const artSrc = (await readFile(path.join(OUT, 'art.js'), 'utf8')).replace(
  /async function steamRoot\(\)[\s\S]*?\n\}/,
  `async function steamRoot() { return ${JSON.stringify(path.join(TMP, 'Steam'))} }`
)
await writeFile(path.join(OUT, 'art.js'), artSrc)

const load = async (name) => import(path.join(OUT, `${name}.js`))
const { buildBaseline } = await load('scan')
const { diffAgainstBaseline } = await load('diff')
const { classify, deriveRules } = await load('classify')
const { quarantine, restore, destroy } = await load('quarantine')
const { backupOriginals, restoreOriginal, hasOriginal } = await load('originals')
const { mount, unmount, collisions, dropStore } = await load('profiles')
const { readDeployments } = await load('vortex')
const { buildMarkdown, findConflicts } = await load('report')
const { parseConfig, diffConfig, revertKeys, detectFormat } = await load('config')
const { captureConfigs, loadConfigIndex, readVersion } = await load('configStore')
const { unityRegistryKey, isRegistryConfig, REGISTRY_PREFIX } = await load('registry')
const { resolveArt } = await load('art')
const { readPe, readIcon } = await load('pe')
const { parseVdf } = await load('detect')
const { buildSpec } = await load('spec')
const { clusterByTime } = await load('timeline')
const { crossReference, inspectFile } = await load('inspect')
const { startWatch, stopWatch } = await load('watch')
const { isUntouchable, listRunning, closeApp } = await load('processes')

const WORKER = path.join(OUT, 'hashWorker.js')
const DATA = path.join(TMP, 'datos')
const quiet = { onProgress: () => {}, isCancelled: () => false }

// ------------------------------------------------- binario PE de prueba

/**
 * Un ejecutable PE64 mínimo pero válido, con un recurso de versión y dos
 * iconos. Sirve para probar el lector de cabeceras sin depender de ningún
 * binario real.
 */
function buildFakePe({ company, product, arch = 'x64', imports = ['d3d11.dll', 'dxgi.dll'] }) {
  const RSRC_RVA = 0x1000
  const IDATA_RVA = 0x3000
  const RSRC_RAW = 0x400
  const IDATA_RAW = 0x1400
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const utf16z = (s) => Buffer.concat([Buffer.from(s, 'utf16le'), u16(0)])

  // --- VS_VERSIONINFO ---
  // Un nodo VERSIONINFO: cabecera de 6 bytes, clave UTF-16, relleno hasta
  // múltiplo de 4 contado desde el inicio del nodo, valor, relleno, hijos.
  const node = (key, value, children, valueLength) => {
    const k = utf16z(key)
    const headKey = Buffer.concat([u16(0), u16(valueLength), u16(1), k])
    const padA = Buffer.alloc((4 - (headKey.length % 4)) % 4)
    const withValue = Buffer.concat([headKey, padA, value])
    const padB = Buffer.alloc((4 - (withValue.length % 4)) % 4)
    const out = Buffer.concat([withValue, padB, ...children])
    out.writeUInt16LE(out.length, 0)
    return out
  }
  const str = (key, value) => node(key, utf16z(value), [], value.length + 1)
  const table = node('040904b0', Buffer.alloc(0), [str('CompanyName', company), str('ProductName', product), str('FileVersion', '1.2.3.4')], 0)
  const sfi = node('StringFileInfo', Buffer.alloc(0), [table], 0)
  const vsvi = node('VS_VERSION_INFO', Buffer.alloc(0), [sfi], 0)

  // --- iconos ---
  const icon1 = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(92)])
  const icon2 = Buffer.alloc(60)
  const group = Buffer.concat([
    u16(0), u16(1), u16(2),
    Buffer.from([32, 32, 0, 0]), u16(1), u16(32), u32(icon1.length), u16(1),
    Buffer.from([16, 16, 0, 0]), u16(1), u16(32), u32(icon2.length), u16(2)
  ])

  // --- árbol de recursos: tipos 3 (icono), 14 (grupo), 16 (versión) ---
  const dir = (entries) => Buffer.concat([Buffer.alloc(12), u16(0), u16(entries.length),
    ...entries.map(([id, off]) => Buffer.concat([u32(id >>> 0), u32(off >>> 0)]))])
  const D = 0x80000000
  // desplazamientos calculados a mano sobre esta disposición fija
  const A = 0, B = 40, C = 72, E = 96, F = 120, G = 144, H = 168, I = 192, J = 216
  const rsrcHead = Buffer.concat([
    dir([[3, B | D], [14, C | D], [16, E | D]]),   // A: raíz (40 bytes)
    dir([[1, F | D], [2, G | D]]),                 // B: iconos (32)
    dir([[1, H | D]]),                             // C: grupo (24)
    dir([[1, I | D]]),                             // E: versión (24)
    dir([[1033, J]]),                              // F: icono 1 -> datos 0
    dir([[1033, J + 16]]),                         // G: icono 2 -> datos 1
    dir([[1033, J + 32]]),                         // H: grupo   -> datos 2
    dir([[1033, J + 48]])                          // I: versión -> datos 3
  ])
  const blobsStart = J + 64
  const o1 = blobsStart, o2 = o1 + icon1.length, o3 = o2 + icon2.length, o4 = o3 + group.length
  const dataEntries = Buffer.concat([
    u32(RSRC_RVA + o1), u32(icon1.length), u32(0), u32(0),
    u32(RSRC_RVA + o2), u32(icon2.length), u32(0), u32(0),
    u32(RSRC_RVA + o3), u32(group.length), u32(0), u32(0),
    u32(RSRC_RVA + o4), u32(vsvi.length), u32(0), u32(0)
  ])
  const rsrc = Buffer.concat([rsrcHead, dataEntries, icon1, icon2, group, vsvi])

  // --- tabla de importaciones ---
  const names = imports.map((n) => Buffer.from(n + '\0', 'latin1'))
  const descSize = 20 * (imports.length + 1)
  let nameOff = descSize
  const descs = []
  for (const n of names) {
    descs.push(Buffer.concat([u32(0), u32(0), u32(0), u32(IDATA_RVA + nameOff), u32(0)]))
    nameOff += n.length
  }
  descs.push(Buffer.alloc(20))
  const idata = Buffer.concat([...descs, ...names])

  // --- cabeceras ---
  const dos = Buffer.alloc(64)
  dos.write('MZ', 0, 'latin1')
  dos.writeUInt32LE(64, 0x3c)
  const machine = arch === 'x64' ? 0x8664 : 0x014c
  const coff = Buffer.concat([u32(0x00004550), u16(machine), u16(2), u32(1700000000), u32(0), u32(0), u16(240), u16(0x0022)])
  const opt = Buffer.alloc(240)
  opt.writeUInt16LE(0x20b, 0)
  opt.writeUInt32LE(16, 108)
  opt.writeUInt32LE(IDATA_RVA, 112 + 1 * 8)
  opt.writeUInt32LE(idata.length, 112 + 1 * 8 + 4)
  opt.writeUInt32LE(RSRC_RVA, 112 + 2 * 8)
  opt.writeUInt32LE(rsrc.length, 112 + 2 * 8 + 4)
  const section = (name, vsize, va, raw) => {
    const b = Buffer.alloc(40)
    b.write(name, 0, 'latin1')
    b.writeUInt32LE(vsize, 8)
    b.writeUInt32LE(va, 12)
    b.writeUInt32LE(vsize, 16)
    b.writeUInt32LE(raw, 20)
    b.writeUInt32LE(0x40000040, 36)
    return b
  }
  const secs = Buffer.concat([section('.rsrc', rsrc.length, RSRC_RVA, RSRC_RAW), section('.idata', idata.length, IDATA_RVA, IDATA_RAW)])
  const head = Buffer.concat([dos, coff, opt, secs])
  const file = Buffer.alloc(IDATA_RAW + idata.length)
  head.copy(file, 0)
  rsrc.copy(file, RSRC_RAW)
  idata.copy(file, IDATA_RAW)
  return file
}

// ================================================================ pruebas

title('Lector de binarios PE')
const exePath = path.join(TMP, 'Juego.exe')
await writeFile(exePath, buildFakePe({ company: 'Estudio Prueba', product: 'Juego Prueba' }))
const pe = await readPe(exePath, { deepScan: true })
ok('arquitectura x64', pe?.arch === 'x64')
ok('lee la empresa del VERSIONINFO', pe?.companyName === 'Estudio Prueba')
ok('lee el producto', pe?.productName === 'Juego Prueba')
ok('lee la versión', pe?.fileVersion === '1.2.3.4')
ok('lee las importaciones', pe?.imports.includes('d3d11.dll') && pe?.imports.includes('dxgi.dll'))
ok('encuentra cadenas de carga dinámica', pe?.dynamicHints.includes('d3d11.dll'))
ok('sin tabla de certificados = sin firma incrustada', pe?.hasEmbeddedSignature === false)
const ico = await readIcon(exePath)
ok('extrae el icono con sus 2 imágenes', ico?.readUInt16LE(4) === 2)
ok('los desplazamientos del .ico cuadran', ico && ico.readUInt32LE(6 + 12) === 38 && ico.length === 38 + 100 + 60)
ok('un archivo que no es PE devuelve null', (await readPe(path.join(ROOT, 'package.json'))) === null)

title('Formato VDF de Steam')
const vdf = parseVdf('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Steam"\n\t\t"apps" { "10" "1" }\n\t}\n\t"1" { "path" "D:\\\\Juegos" }\n}')
ok('lee las bibliotecas', vdf.libraryfolders['0'].path === 'C:\\Steam' && vdf.libraryfolders['1'].path === 'D:\\Juegos')
ok('lee bloques anidados', vdf.libraryfolders['0'].apps['10'] === '1')

title('Línea base y ficha técnica')
const G = path.join(TMP, 'Juego')
await mkdir(path.join(G, 'Engine/Binaries'), { recursive: true })
await mkdir(path.join(G, 'Juego/Binaries/Win64'), { recursive: true })
await mkdir(path.join(G, 'Juego/Content/Paks'), { recursive: true })
await mkdir(path.join(G, 'EasyAntiCheat'), { recursive: true })
await mkdir(path.join(G, 'Data'), { recursive: true })
await copyFile(exePath, path.join(G, 'Juego/Binaries/Win64/Juego-Win64-Shipping.exe'))
await copyFile(exePath, path.join(G, 'Juego/Binaries/Win64/CrashReportClient.exe'))
await writeFile(path.join(G, 'Engine/Binaries/core.dll'), Buffer.alloc(700, 6))
await writeFile(path.join(G, 'Juego/Content/Paks/pakchunk0.pak'), Buffer.alloc(120000, 3))
await writeFile(path.join(G, 'Data/texturas.pak'), Buffer.alloc(9000, 2))
await writeFile(path.join(G, 'EasyAntiCheat/EasyAntiCheat_x64.dll'), Buffer.alloc(500, 4))
await writeFile(path.join(G, 'settings.ini'), '[Video]\nShadows=2\nVSync = 1\n')
await writeFile(path.join(G, 'DATA_SETTINGS.XML'), '<?xml version="1.0"?>\n<Settings>\n  <Graphics quality="high">\n    <FOV>70</FOV>\n  </Graphics>\n</Settings>\n')

const baseline = await buildBaseline({ gameId: 'j', roots: [G], workerFile: WORKER, ...quiet })
ok(`recorre hasta el último archivo (${baseline.summary.fileCount})`, baseline.summary.fileCount === 8)
ok('cada archivo lleva su SHA-256', baseline.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)))

const spec = await buildSpec({ gameName: 'Juego Prueba', gamePath: G, relPaths: baseline.files.map((f) => f.rel) })
ok('identifica Unreal Engine', spec.engine === 'Unreal Engine')
ok('elige el ejecutable correcto y no el CrashReportClient', spec.mainExecutable === 'Juego/Binaries/Win64/Juego-Win64-Shipping.exe')
ok('deduce DirectX 11 por importaciones', spec.apis.some((a) => a.api === 'dx11' && a.confidence === 'alta'))
ok('detecta Easy Anti-Cheat', spec.antiCheat.some((a) => a.name === 'Easy Anti-Cheat'))

const originals = await backupOriginals({ dataDir: DATA, gameId: 'j', roots: [G], files: baseline.files, hasStoreVerification: true })
ok(`copia los originales pequeños: 2 exe + 2 dll + ini + xml = 6 (${originals.fileCount})`, originals.fileCount === 6)
ok('los .pak grandes no se copian', !(await hasOriginal(DATA, 'j', 0, 'Data/texturas.pak')))

title('El usuario trastea')
await mkdir(path.join(G, 'reshade-shaders/Shaders'), { recursive: true })
await mkdir(path.join(G, 'TexturasHD'), { recursive: true })
await writeFile(path.join(G, 'ReShade.ini'), '[GENERAL]\n')
await writeFile(path.join(G, 'reshade-shaders/Shaders/Clarity.fx'), '// fx\n')
await writeFile(path.join(G, 'Romulus.ini'), '[GENERAL]\nTechniques=Clarity@Clarity.fx\nPreprocessorDefinitions=\n')
await writeFile(path.join(G, 'dxgi.dll'), buildFakePe({ company: 'Alguien', product: 'Inyector misterioso', imports: ['kernel32.dll'] }))
await writeFile(path.join(G, 'TexturasHD/tex.pak'), Buffer.alloc(5000, 9))
await writeFile(path.join(G, 'TexturasHD/leeme.md'), 'mod\n')
await writeFile(path.join(G, 'Data/armas.pak'), Buffer.alloc(4000, 7))
await writeFile(path.join(G, 'Data/vortex.deployment.json'), JSON.stringify({ files: [
  { relPath: 'armas.pak', source: 'Armas HD-1234-2-1.zip' },
  { relPath: 'texturas.pak', source: 'Armas HD-1234-2-1.zip' }
] }))
await writeFile(path.join(G, 'Data/texturas.pak'), Buffer.alloc(9500, 8))                  // original pisado
await writeFile(path.join(G, 'settings.ini'), '[Video]\nShadows=4\nVSync = 1\nHDR=1\n')     // config tocada
await copyFile(path.join(G, 'DATA_SETTINGS.XML'), path.join(G, 'DATA_SETTINGS.XML.BAK'))   // copia del parcheador
await writeFile(path.join(G, 'DATA_SETTINGS.XML'), '<?xml version="1.0"?>\n<Settings>\n  <Graphics quality="ultra">\n    <FOV>103</FOV>\n  </Graphics>\n</Settings>\n')
await rename(path.join(G, 'Juego/Content/Paks/pakchunk0.pak'), path.join(G, 'Juego/Content/Paks/pakchunk0.pak.BAK')) // renombrado
await rm(path.join(G, 'Engine/Binaries'), { recursive: true })

// --- el caso de Pragmata: REFramework y un ajuste cambiado desde el menú del juego
await mkdir(path.join(G, '_storage_'), { recursive: true })
await writeFile(path.join(G, 'dinput8.dll'), buildFakePe({ company: '', product: '', imports: ['kernel32.dll'] }))
await writeFile(path.join(G, 're2_fw_config.txt'), 'FrameworkConfig...\n')
await writeFile(path.join(G, 'reframework_accessed_files.txt'), '')
await writeFile(path.join(G, 'ref_ui.ini'), '[ui]\n')
await copyFile(path.join(G, 'Data/armas.pak'), path.join(G, '_storage_/armas.pak'))       // copia manual de algo nuevo
await writeFile(path.join(G, '_storage_/nvngx_dlss.dll'), Buffer.alloc(300, 11))          // respaldo de DLSS Swapper

title('Comparación con la línea base')
const diff = await diffAgainstBaseline({ gameId: 'j', roots: [G], baseline, workerFile: WORKER, deep: false, ...quiet })
const n = (s) => diff.entries.filter((e) => e.status === s).length
ok(`16 nuevos (${n('nuevo')})`, n('nuevo') === 16)
ok(`3 modificados (${n('modificado')})`, n('modificado') === 3)
ok(`2 desaparecidos (${n('desaparecido')})`, n('desaparecido') === 2)
ok(`solo relee lo sospechoso: 19 (${diff.rehashed})`, diff.rehashed === 19)
ok('empareja el renombrado por huella', diff.entries.find((e) => e.rel === 'Juego/Content/Paks/pakchunk0.pak.BAK')?.pairedWith?.kind === 'renombrado-desde')
ok('empareja la copia del parcheador', diff.entries.find((e) => e.rel === 'DATA_SETTINGS.XML.BAK')?.pairedWith?.kind === 'copia-de')
ok('el XML sobrescrito es recuperable desde su .BAK', diff.entries.find((e) => e.rel === 'DATA_SETTINGS.XML')?.recoverableFrom === 'DATA_SETTINGS.XML.BAK')

title('Clasificación')
for (const e of diff.entries) if (e.status === 'modificado') e.hasOriginal = (await hasOriginal(DATA, 'j', e.root, e.rel)) || !!e.recoverableFrom
const deployment = await readDeployments([G])
ok('lee el manifiesto de Vortex con prefijo de carpeta', deployment.files.get('data/armas.pak') === 'Armas HD')
let { entries, groups } = await classify({ entries: diff.entries, roots: [G], protectedRoots: new Set(), learned: [], deployed: deployment.files, gameId: 'j', batchLabel: 'hoy' })
const find = (name) => groups.find((g) => g.name === name)
console.log('   grupos: ' + groups.map((g) => `${g.name} [${g.fileCount}]`).join(' · '))
ok('ReShade con sus archivos y el preajuste de nombre libre', find('ReShade')?.fileCount === 3)
ok('la dxgi.dll que no es ReShade se marca como inyector', find('DLL proxy sin identificar')?.fileCount === 1)
ok('REFramework se reconoce por sus archivos característicos', find('REFramework')?.fileCount === 4)
ok('y reclama la dinput8.dll sin datos de versión que tiene al lado', entries.find((e) => e.rel === 'dinput8.dll')?.groupId === 'firma:reframework')
ok('la copia manual de un archivo nuevo no se confunde con un respaldo de original', entries.find((e) => e.rel === '_storage_/armas.pak')?.pairedWith == null)
ok('la carpeta de respaldo se reconoce como DLSS Swapper', find('DLSS Swapper')?.fileCount === 2)
ok('cada mod de Vortex con su nombre real', find('Vortex · Armas HD')?.fileCount === 2)
ok('renombrados en su grupo bloqueado, original y .BAK juntos', find('Originales desactivados renombrando')?.fileCount === 2 && find('Originales desactivados renombrando')?.locked === true)
ok('la copia del parcheador es purgable', find('Copias de seguridad de originales')?.locked === false)
ok('lo desaparecido de verdad tiene su grupo', find('Originales que faltan')?.fileCount === 1)
ok('las configuraciones modificadas van juntas', find('Configuración modificada')?.fileCount === 2)
ok('lo desconocido cae en el lote', groups.find((g) => g.category === 'desconocido')?.fileCount === 2)
ok('el manifiesto de Vortex se reconoce como del gestor', groups.some((g) => g.category === 'gestor'))

const unknown = groups.find((g) => g.category === 'desconocido')
const rules = deriveRules(entries.filter((e) => e.groupId === unknown.id && e.rel.startsWith('TexturasHD/')), entries, 'Texturas HD', 'contenido', 'j')
ok(`aprende la carpeta exclusiva del mod (${rules[0]?.pattern})`, rules.length === 1 && rules[0].pattern === 'texturashd/')
const shared = deriveRules(entries.filter((e) => e.rel === 'Data/armas.pak'), entries, 'Armas', 'contenido', 'j')
ok(`en una carpeta compartida la regla es el archivo exacto (${shared[0]?.pattern})`, shared[0]?.pattern === 'data/armas.pak')
const again = await classify({ entries: JSON.parse(JSON.stringify(diff.entries)), roots: [G], protectedRoots: new Set(), learned: rules, deployed: deployment.files, gameId: 'j', batchLabel: 'hoy' })
ok('la regla aprendida se aplica en la siguiente revisión', again.groups.some((g) => g.name === 'Texturas HD' && g.fileCount === 2))

title('Conflictos e informe')
const report = { gameId: 'j', takenAt: new Date().toISOString(), durationMs: 1, deep: false, baselineTakenAt: baseline.summary.takenAt, rehashed: 0, entries, groups }
const conflicts = findConflicts(report)
ok('atribuye la sobrescritura al mod de Vortex', conflicts.some((c) => c.groupName === 'Vortex · Armas HD' && c.files.includes('Data/texturas.pak')))
ok('un ajuste cambiado desde el menú del juego no es un conflicto', !conflicts.some((c) => c.category === 'configuracion'))
const md = buildMarkdown({ game: { id: 'j', name: 'Juego Prueba', path: G, platform: 'steam', appId: '1', linkedPaths: [], addedAt: '', baseline: baseline.summary, spec }, report, profiles: [], batches: [], history: { gameId: 'j', revisions: [], sessions: [] }, conflicts })
ok('el informe lleva ficha, grupos y sobrescrituras', md.includes('# Juego Prueba') && md.includes('Vortex · Armas HD') && md.includes('## Sobrescrituras'))

title('Cuarentena')
const reshade = entries.filter((e) => e.groupId === find('ReShade').id && e.status === 'nuevo')
const batch = await quarantine({ gameId: 'j', gameName: 'Juego', label: 'ReShade', category: 'postproceso', roots: [G], entries: reshade, fallbackDir: DATA })
ok(`mueve los 3 archivos (${batch.itemCount})`, batch.itemCount === 3)
ok('desaparecen del juego', !existsSync(path.join(G, 'ReShade.ini')) && !existsSync(path.join(G, 'reshade-shaders/Shaders/Clarity.fx')))
ok('lo de otros grupos sigue intacto', existsSync(path.join(G, 'dxgi.dll')))
const back = await restore(batch)
ok(`los devuelve todos (${back.restored})`, back.restored === 3 && existsSync(path.join(G, 'reshade-shaders/Shaders/Clarity.fx')))
const batch2 = await quarantine({ gameId: 'j', gameName: 'Juego', label: 'x', category: 'contenido', roots: [G], entries: entries.filter((e) => e.rel === 'TexturasHD/leeme.md'), fallbackDir: DATA })
await destroy(batch2)
ok('el vaciado definitivo borra el almacén del lote', batch2.items.every((i) => !existsSync(i.to)))

title('Originales')
const r1 = await restoreOriginal(DATA, 'j', [G], 0, 'settings.ini')
ok('restaura un original desde la copia', r1.ok && (await readFile(path.join(G, 'settings.ini'), 'utf8')) === '[Video]\nShadows=2\nVSync = 1\n')

title('Perfiles')
const items = reshade.map((e) => ({ root: e.root, rel: e.rel, size: e.size }))
const profile = { id: 'p1', gameId: 'j', name: 'Solo ReShade', color: '#a855f7', mounted: true, createdAt: '', fileCount: items.length, totalBytes: 0, items }
const down = await unmount(profile, [G], DATA)
ok(`desmontar aparta los 3 archivos (${down.moved})`, down.moved === 3 && !existsSync(path.join(G, 'ReShade.ini')))
ok('no toca nada más', existsSync(path.join(G, 'dxgi.dll')) && existsSync(path.join(G, 'Data/armas.pak')))
const up = await mount(profile, [G], DATA)
ok(`montar los devuelve (${up.moved})`, up.moved === 3 && existsSync(path.join(G, 'reshade-shaders/Shaders/Clarity.fx')))
ok('detecta choques sin mover nada', collisions(profile, [G]).length === 3)
const twice = await mount(profile, [G], DATA)
ok('montar sobre algo existente no pisa y avisa', twice.moved === 0 && twice.skipped.length === 3)
await unmount(profile, [G], DATA)
await mount(profile, [G], DATA)
await dropStore(profile, [G], DATA)
ok('borrar el almacén del perfil deja el juego como estaba', existsSync(path.join(G, 'ReShade.ini')))

title('Configuraciones clave por clave')
const ini = diffConfig('[Video]\nShadows=2\nVSync = 1\n', '[Video]\nShadows=4\nVSync = 1\nHDR=1\n', 'ini')
ok('INI: cambio y clave nueva', ini.changed.length === 1 && ini.changed[0].key === 'Video.Shadows' && ini.added[0].key === 'Video.HDR')
const rev = revertKeys('[Video]\nShadows=4\n   VSync = 1\nHDR=1\n', 'ini', [{ key: 'Video.Shadows', value: '2' }])
ok('INI: revierte una clave conservando sangrado y resto', rev?.text === '[Video]\nShadows=2\n   VSync = 1\nHDR=1\n')
const xa = await readFile(path.join(DATA, 'originals/j/0/DATA_SETTINGS.XML'), 'utf8')
const xb = await readFile(path.join(G, 'DATA_SETTINGS.XML'), 'utf8')
const xd = diffConfig(xa, xb, 'xml')
ok('XML: ve el FOV y el atributo', xd.changed.some((c) => c.key === 'Settings.Graphics.FOV' && c.to === '103') && xd.changed.some((c) => c.key === 'Settings.Graphics@quality'))
const xr = revertKeys(xb, 'xml', [{ key: 'Settings.Graphics.FOV', value: '70' }])
ok('XML: revierte solo el FOV y deja ultra', xr?.text.includes('<FOV>70</FOV>') && xr.text.includes('quality="ultra"') && xr.text.startsWith('<?xml'))
ok('XML: entidades ida y vuelta', parseConfig('<a t="1 &lt; 2">x &amp; y</a>', 'xml').fields.get('a').value === 'x & y' && revertKeys('<a>x</a>', 'xml', [{ key: 'a', value: '1<2' }])?.text === '<a>1&lt;2</a>')
ok('JSON: compara pero no edita', diffConfig('{"a":{"b":1}}', '{"a":{"b":2}}', 'json').changed[0].key === 'a.b' && revertKeys('{"a":1}', 'json', [{ key: 'a', value: '2' }]) === null)
ok('nunca escribe sobre algo que no entiende', revertKeys('<a><b attr=sin>1</b></a>', 'xml', [{ key: 'a.b', value: '2' }]) === null)
ok('detecta formatos', detectFormat('x.INI') === 'ini' && detectFormat('x.xml') === 'xml' && detectFormat('x.pak') === null)

title('Historial de configuraciones y registro')
await captureConfigs(DATA, 'j', [G], [{ root: 0, rel: 'DATA_SETTINGS.XML' }])
await captureConfigs(DATA, 'j', [G], [{ root: 0, rel: 'DATA_SETTINGS.XML' }])
const idx = await loadConfigIndex(DATA, 'j')
const hist = idx.find((f) => f.rel === 'DATA_SETTINGS.XML')
ok('archiva la de fábrica más la actual, sin duplicar', hist?.versions.length === 2 && hist.versions.some((v) => v.factory))
ok('la de fábrica es la original', (await readVersion(DATA, 'j', hist.slug, hist.versions.find((v) => v.factory).file)) === xa)
ok('deduce la clave del registro de Unity', unityRegistryKey({ companyName: 'Obsidian', productName: 'Grounded' }) === 'HKCU\\Software\\Obsidian\\Grounded')
ok('rechaza nombres con barras', unityRegistryKey({ companyName: 'a\\b', productName: 'c' }) === null)
const reg = REGISTRY_PREFIX + 'HKCU\\Software\\X\\Y'
await captureConfigs(DATA, 'j', [G], [{ root: 0, rel: reg, content: '[(raíz)]\nfov=70\n' }])
await captureConfigs(DATA, 'j', [G], [{ root: 0, rel: reg, content: '[(raíz)]\nfov=103\n' }])
ok('el registro se archiva como una configuración más', isRegistryConfig(reg) && (await loadConfigIndex(DATA, 'j')).find((f) => f.rel === reg)?.versions.length === 2)

title('Línea de tiempo')
// Fechas fabricadas: tres tandas separadas, como tres instalaciones distintas.
const conFechas = entries.map((e) => ({ ...e }))
const T = Date.parse('2026-09-03T23:00:00Z')
for (const e of conFechas) {
  if (e.status === 'desaparecido') continue
  if (e.rel.startsWith('reshade') || e.rel === 'ReShade.ini' || e.rel === 'Romulus.ini') e.mtimeMs = T
  else if (e.rel === 'dinput8.dll' || e.rel.startsWith('re2_') || e.rel.startsWith('ref') ) e.mtimeMs = T + 21 * 60000
  else e.mtimeMs = T + 40 * 60000
}
const momentos = clusterByTime(conFechas, groups)
ok(`separa las tandas en 3 momentos (${momentos.length})`, momentos.length === 3)
ok('el más reciente va primero', momentos[0].at > momentos[2].at)
ok('cada momento dice de qué grupos es', momentos.every((m) => m.groups.length > 0))
ok('el momento de ReShade agrupa sus archivos',
   momentos[2].groups.includes('ReShade') && momentos[2].fileCount >= 3)
ok('los desaparecidos no entran, porque no tienen fecha',
   momentos.reduce((n, m) => n + m.fileCount, 0) === conFechas.filter((e) => e.status !== 'desaparecido').length)
ok('sin fechas devuelve una lista vacía en vez de romper',
   clusterByTime(entries.map((e) => ({ ...e, mtimeMs: 0 })), groups).length === 0)

title('El mismo archivo en varios juegos')
const informeA = { gameId: 'a', takenAt: '', durationMs: 0, deep: false, baselineTakenAt: '', rehashed: 0,
  groups: [{ id: 'g1', name: 'ReShade', category: 'postproceso', kind: 'firma', fileCount: 2, totalBytes: 0, counts: { nuevo: 2, modificado: 0, desaparecido: 0 }, locked: false }],
  entries: [
    { rel: 'dxgi.dll', root: 0, status: 'nuevo', size: 100, mtimeMs: 1, sha256: 'AAA', groupId: 'g1' },
    { rel: 'guardado.sav', root: 0, status: 'nuevo', size: 10, mtimeMs: 1, sha256: 'SSS', groupId: 'gp' }
  ] }
const informeB = { ...informeA, gameId: 'b',
  groups: [{ ...informeA.groups[0], id: 'g1', name: 'ReShade' }, { id: 'gp', name: 'Partidas', category: 'partida', kind: 'firma', fileCount: 1, totalBytes: 0, counts: { nuevo: 1, modificado: 0, desaparecido: 0 }, locked: true }],
  entries: [
    { rel: 'dxgi.dll', root: 0, status: 'nuevo', size: 90, mtimeMs: 1, sha256: 'BBB', groupId: 'g1' },
    { rel: 'guardado.sav', root: 0, status: 'nuevo', size: 10, mtimeMs: 1, sha256: 'SSS', groupId: 'gp' }
  ] }
const informeC = { ...informeA, gameId: 'c', entries: [{ rel: 'dxgi.dll', root: 0, status: 'nuevo', size: 100, mtimeMs: 1, sha256: 'AAA', groupId: 'g1' }] }
const cruce = crossReference({
  games: [{ id: 'a', name: 'Juego A' }, { id: 'b', name: 'Juego B' }, { id: 'c', name: 'Juego C' }],
  reports: new Map([['a', informeA], ['b', informeB], ['c', informeC]])
})
ok(`encuentra un archivo repetido (${cruce.length})`, cruce.length === 1 && cruce[0].rel === 'dxgi.dll')
ok('agrupa los dos juegos con la misma versión', cruce[0].places.length === 2)
ok('y señala el que tiene otra versión',
   cruce[0].variants.length === 1 && cruce[0].variants[0].gameName === 'Juego B')
ok('las partidas guardadas no se cruzan aunque coincidan', !cruce.some((f) => f.rel === 'guardado.sav'))

title('Ficha de un archivo')
const fichaDll = await inspectFile([G], 0, 'dinput8.dll', report)
ok('mide el archivo y lee su fecha', fichaDll.exists && fichaDll.size > 0 && !!fichaDll.modified)
ok('lee la cabecera del binario', fichaDll.pe?.arch === 'x64')
ok('calcula la huella si no venía de la revisión', /^[0-9a-f]{64}$/.test(fichaDll.sha256 ?? ''))
const fichaIni = await inspectFile([G], 0, 'ReShade.ini', report)
ok('de un texto enseña las primeras líneas', fichaIni.isText && fichaIni.preview?.includes('[GENERAL]'))
ok('dice a qué grupo pertenece', fichaIni.group === 'ReShade')
const fichaNo = await inspectFile([G], 0, 'no-existe.dll', report)
ok('un archivo que no está no rompe nada', fichaNo.exists === false)
const fichaPak = await inspectFile([G], 0, 'Data/armas.pak', report)
ok('un binario que no es PE no se enseña como texto', !fichaPak.isText && !fichaPak.pe)

title('Vigilante')
const vig = await startWatch('j', [G])
ok(`la foto anota la carpeta entera (${vig.files.size})`, vig.files.size > 20)
await mkdir(path.join(G, '_sospechoso_'), { recursive: true })
await writeFile(path.join(G, '_sospechoso_/copia.dll'), Buffer.alloc(700, 4))
await writeFile(path.join(G, 'ReShade.ini'), '[GENERAL]\nCambiado=1\n')
const vigR = await stopWatch(vig)
ok('pilla lo que ha aparecido', vigR.changes.some((c) => c.kind === 'apareció' && c.rel === '_sospechoso_/copia.dll'))
ok('y lo que ha cambiado', vigR.changes.some((c) => c.kind === 'cambió' && c.rel === 'ReShade.ini'))
ok('no señala lo que nadie tocó', !vigR.changes.some((c) => c.rel.includes('pakchunk0')))
const vig2 = await startWatch('j', [G])
ok('sin actividad, ni un cambio', (await stopWatch(vig2)).changes.length === 0)
await rm(path.join(G, '_sospechoso_'), { recursive: true, force: true })

title('Qué más está corriendo')
for (const proc of ['svchost', 'lsass', 'dwm.exe', 'EasyAntiCheat', 'BEService', 'csrss', 'MsMpEng'])
  ok(`nunca se propone cerrar ${proc}`, isUntouchable(proc))
for (const proc of ['chrome', 'discord', 'obs64', 'iCUE', 'Dropbox'])
  ok(`sí se puede proponer cerrar ${proc}`, !isUntouchable(proc))
ok('el motor rechaza cerrar un proceso del sistema aunque se lo pidan',
   (await closeApp(4, 'svchost')).ok === false)
ok('fuera de Windows devuelve lista vacía en vez de fallar', (await listRunning(10)).length === 0)

title('Carátulas')
const STEAM = path.join(TMP, 'Steam')
await mkdir(path.join(STEAM, 'appcache/librarycache/214490'), { recursive: true })
await mkdir(path.join(STEAM, 'steamapps'), { recursive: true })
for (const f of ['library_600x900.jpg', 'library_hero.jpg', 'logo.png', 'icon.jpg']) await writeFile(path.join(STEAM, 'appcache/librarycache/214490', f), Buffer.alloc(300, 1))
await writeFile(path.join(STEAM, 'appcache/librarycache/730_header.jpg'), Buffer.alloc(300, 2))
const a = await resolveArt({ id: 'steam:214490', name: 'Alien', path: G, platform: 'steam', appId: '214490', linkedPaths: [], addedAt: '' }, DATA)
ok('Steam nuevo: carátula, fondo, logotipo e icono', a?.cover && a?.hero && a?.logo && a?.icon && a.source === 'caché de Steam')
// Steam nuevo con nombres sin significado: hay que reconocerlo por proporciones.
await mkdir(path.join(STEAM, 'appcache/librarycache/999'), { recursive: true })
const jpeg = (w, h) => Buffer.concat([
  Buffer.from('ffd8', 'hex'),
  Buffer.from('ffe000104a46494600010100000100010000', 'hex'),
  Buffer.from('ffc00011', 'hex'), Buffer.from([8]),
  Buffer.from([h >> 8, h & 255, w >> 8, w & 255]), Buffer.from([3]), Buffer.alloc(9),
  Buffer.from('ffd9', 'hex')
])
await writeFile(path.join(STEAM, 'appcache/librarycache/999/a1b2c3.jpg'), jpeg(600, 900))
await writeFile(path.join(STEAM, 'appcache/librarycache/999/d4e5f6.jpg'), jpeg(1920, 620))
await writeFile(path.join(STEAM, 'appcache/librarycache/999/f1e2d3.jpg'), jpeg(32, 32))
const sinNombre = await resolveArt({ id: 'steam:999', name: 'Nuevo', path: G, platform: 'steam', appId: '999', linkedPaths: [], addedAt: '' }, DATA)
ok('reconoce el arte de Steam aunque los nombres no digan nada',
   sinNombre?.source === 'caché de Steam' && !!sinNombre.cover && !!sinNombre.hero && !!sinNombre.icon)

const b = await resolveArt({ id: 'steam:730', name: 'Otro', path: G, platform: 'steam', appId: '730', linkedPaths: [], addedAt: '' }, DATA)
ok('Steam antiguo: cabecera plana', b?.hero === 'steam_730-hero.jpg')
const gogDir = path.join(TMP, 'GOG')
await mkdir(gogDir, { recursive: true })
await writeFile(path.join(gogDir, 'goggame-1.ico'), Buffer.alloc(200, 5))
const c = await resolveArt({ id: 'gog:1', name: 'G', path: gogDir, platform: 'gog', linkedPaths: [], addedAt: '' }, DATA)
ok('GOG: su .ico', c?.source === 'icono de la carpeta del juego')
const d = await resolveArt({ id: 'manual:x', name: 'Manual', path: G, platform: 'manual', linkedPaths: [], addedAt: '', spec }, DATA)
ok('sin Steam ni GOG: icono extraído del ejecutable', d?.source === 'icono del ejecutable' && d.icon?.endsWith('.ico'))
ok('archivos copiados a la carpeta de arte', (await readdir(path.join(DATA, 'art'))).length >= 10)

// ---------------------------------------------------------------- final

await rm(TMP, { recursive: true, force: true })
console.log(`\n${passed} correctas, ${failed} fallos`)
if (failed) {
  console.log('>>> HAY FALLOS')
  process.exitCode = 1
} else {
  console.log('>>> TODO CORRECTO')
}
