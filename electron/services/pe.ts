/**
 * Lector de cabeceras PE (los .exe y .dll de Windows).
 *
 * Saca cuatro cosas que nos interesan:
 *   1. Arquitectura y si es DLL.
 *   2. Tabla de importaciones, para saber qué APIs enlaza el binario.
 *   3. Recurso VERSIONINFO, que suele decir literalmente quién hizo el archivo.
 *   4. Si lleva firma Authenticode incrustada.
 *
 * Escrito a mano y sin dependencias a propósito: las librerías de PE de npm
 * cargan el archivo entero en memoria, y aquí hay ejecutables de 300 MB.
 * Todo va envuelto en try/catch porque un binario raro nunca debe tumbar un escaneo.
 */

import { open, stat, type FileHandle } from 'node:fs/promises'
import type { PeInfo } from '../../shared/types'

const MACHINE: Record<number, PeInfo['arch']> = {
  0x014c: 'x86',
  0x8664: 'x64',
  0xaa64: 'arm64'
}

interface Section {
  name: string
  virtualAddress: number
  virtualSize: number
  rawPointer: number
  rawSize: number
}

const align4 = (n: number) => (n + 3) & ~3

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0)
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fh.read(buf, 0, length, position)
  return bytesRead === length ? buf : buf.subarray(0, bytesRead)
}

function rvaToOffset(sections: Section[], rva: number): number | null {
  for (const s of sections) {
    const size = Math.max(s.virtualSize, s.rawSize)
    if (rva >= s.virtualAddress && rva < s.virtualAddress + size) {
      return s.rawPointer + (rva - s.virtualAddress)
    }
  }
  return null
}

function readCString(buf: Buffer, offset: number, max = 256): string {
  let end = offset
  while (end < buf.length && end - offset < max && buf[end] !== 0) end++
  return buf.toString('latin1', offset, end)
}

/** Recorre el árbol de VS_VERSIONINFO y devuelve las cadenas clave/valor. */
function parseVersionInfo(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}

  function node(offset: number, depth: number): void {
    if (depth > 6 || offset + 6 > buf.length) return
    const length = buf.readUInt16LE(offset)
    const valueLength = buf.readUInt16LE(offset + 2)
    const type = buf.readUInt16LE(offset + 4)
    if (length < 6 || offset + length > buf.length) return

    // La clave es UTF-16 terminada en cero.
    let p = offset + 6
    let keyEnd = p
    while (keyEnd + 1 < offset + length && buf.readUInt16LE(keyEnd) !== 0) keyEnd += 2
    const key = buf.toString('utf16le', p, keyEnd)
    p = align4(keyEnd + 2)

    const valueBytes = type === 1 ? valueLength * 2 : valueLength

    if (type === 1 && valueLength > 0 && key && p + valueBytes <= offset + length) {
      const raw = buf.toString('utf16le', p, p + valueBytes)
      out[key] = raw.replace(/\0+$/, '').trim()
    }

    // Los hijos empiezan detrás del valor, realineados a 4 bytes.
    let child = align4(p + valueBytes)
    while (child + 6 <= offset + length) {
      const childLength = buf.readUInt16LE(child)
      if (childLength < 6) break
      node(child, depth + 1)
      child = align4(child + childLength)
    }
  }

  node(0, 0)
  return out
}

/**
 * El directorio de recursos de un PE es un árbol de tres niveles:
 * tipo (icono, versión...), nombre o id, e idioma. Al final de cada rama hay
 * una entrada que apunta a los datos.
 */
function resourceEntries(res: Buffer, dirOffset: number): { id: number; offset: number; isDir: boolean }[] {
  if (dirOffset + 16 > res.length) return []
  const named = res.readUInt16LE(dirOffset + 12)
  const ids = res.readUInt16LE(dirOffset + 14)
  const list: { id: number; offset: number; isDir: boolean }[] = []
  for (let i = 0; i < named + ids; i++) {
    const e = dirOffset + 16 + i * 8
    if (e + 8 > res.length) break
    const id = res.readUInt32LE(e)
    const off = res.readUInt32LE(e + 4)
    list.push({ id: id & 0x7fffffff, offset: off & 0x7fffffff, isDir: (off & 0x80000000) !== 0 })
  }
  return list
}

/** Devuelve todos los recursos de un tipo, indexados por su id. */
function resourcesOfType(res: Buffer, typeId: number): Map<number, { rva: number; size: number }> {
  const out = new Map<number, { rva: number; size: number }>()
  const type = resourceEntries(res, 0).find((t) => t.id === typeId && t.isDir)
  if (!type) return out
  for (const name of resourceEntries(res, type.offset)) {
    const dataOffset = name.isDir ? resourceEntries(res, name.offset)[0]?.offset : name.offset
    if (dataOffset == null || dataOffset + 8 > res.length) continue
    out.set(name.id, { rva: res.readUInt32LE(dataOffset), size: res.readUInt32LE(dataOffset + 4) })
  }
  return out
}

function findVersionResource(res: Buffer): { rva: number; size: number } | null {
  const versions = resourcesOfType(res, 16)
  return [...versions.values()][0] ?? null
}

/** Busca cadenas dentro del binario, en ASCII y en UTF-16, por trozos. */
async function findStrings(fh: FileHandle, size: number, needles: string[]): Promise<string[]> {
  const found = new Set<string>()
  const patterns = needles.flatMap((n) => [
    { needle: n, buf: Buffer.from(n, 'latin1') },
    { needle: n, buf: Buffer.from(n, 'utf16le') }
  ])
  const CHUNK = 4 * 1024 * 1024
  const OVERLAP = 128
  let position = 0
  let tail: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  while (position < size) {
    const chunk = await readAt(fh, position, Math.min(CHUNK, size - position))
    if (!chunk.length) break
    const hay = tail.length ? Buffer.concat([tail, chunk]) : chunk
    for (const p of patterns) {
      if (found.has(p.needle)) continue
      if (hay.includes(p.buf)) found.add(p.needle)
    }
    tail = hay.subarray(Math.max(0, hay.length - OVERLAP))
    position += chunk.length
    if (found.size === needles.length) break
  }
  return [...found]
}

const API_NEEDLES = [
  'D3D12CreateDevice',
  'D3D11CreateDevice',
  'Direct3DCreate9',
  'CreateDXGIFactory',
  'vkCreateInstance',
  'wglCreateContext',
  'd3d12.dll',
  'd3d11.dll',
  'd3d9.dll',
  'dxgi.dll',
  'vulkan-1.dll',
  'opengl32.dll'
]

/**
 * Extrae el icono de un ejecutable y lo devuelve como archivo .ico.
 *
 * En Windows un icono no se guarda entero: hay un "grupo" (tipo 14) que es un
 * índice de tamaños, y cada tamaño es un recurso aparte (tipo 3). Para
 * reconstruir el .ico hay que leer el índice, recoger cada imagen y volver a
 * montar la cabecera con los desplazamientos correctos.
 */
export async function readIcon(filePath: string): Promise<Buffer | null> {
  let fh: FileHandle | null = null
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size < 512) return null
    fh = await open(filePath, 'r')

    const head = await readAt(fh, 0, 64)
    if (head.length < 64 || head.readUInt16LE(0) !== 0x5a4d) return null
    const peOffset = head.readUInt32LE(0x3c)
    const coff = await readAt(fh, peOffset, 24)
    if (coff.length < 24 || coff.readUInt32LE(0) !== 0x00004550) return null

    const sectionCount = coff.readUInt16LE(6)
    const optSize = coff.readUInt16LE(20)
    const optOffset = peOffset + 24
    const opt = await readAt(fh, optOffset, Math.min(optSize, 256))
    const plus = opt.readUInt16LE(0) === 0x20b
    const dirOffset = plus ? 112 : 96
    if (opt.length < dirOffset + 24) return null
    const resRva = opt.readUInt32LE(dirOffset + 16)
    const resSize = opt.readUInt32LE(dirOffset + 20)
    if (!resRva || !resSize || resSize > 32 * 1024 * 1024) return null

    const secBuf = await readAt(fh, optOffset + optSize, sectionCount * 40)
    const sections: Section[] = []
    for (let i = 0; i < sectionCount; i++) {
      const o = i * 40
      if (o + 40 > secBuf.length) break
      sections.push({
        name: readCString(secBuf, o, 8),
        virtualSize: secBuf.readUInt32LE(o + 8),
        virtualAddress: secBuf.readUInt32LE(o + 12),
        rawSize: secBuf.readUInt32LE(o + 16),
        rawPointer: secBuf.readUInt32LE(o + 20)
      })
    }

    const resOffset = rvaToOffset(sections, resRva)
    if (resOffset == null) return null
    const res = await readAt(fh, resOffset, resSize)

    const groups = resourcesOfType(res, 14) // RT_GROUP_ICON
    const icons = resourcesOfType(res, 3) // RT_ICON
    const groupIds = [...groups.keys()].sort((a, b) => a - b)
    if (!groupIds.length || !icons.size) return null

    const group = groups.get(groupIds[0])!
    const groupOffset = rvaToOffset(sections, group.rva)
    if (groupOffset == null) return null
    const dir = await readAt(fh, groupOffset, group.size)
    if (dir.length < 6) return null

    const countEntries = dir.readUInt16LE(4)
    const images: { entry: Buffer; data: Buffer }[] = []
    for (let i = 0; i < countEntries; i++) {
      const at = 6 + i * 14
      if (at + 14 > dir.length) break
      const nID = dir.readUInt16LE(at + 12)
      const icon = icons.get(nID)
      if (!icon) continue
      const iconOffset = rvaToOffset(sections, icon.rva)
      if (iconOffset == null) continue
      const data = await readAt(fh, iconOffset, icon.size)
      if (!data.length) continue
      // Los 12 primeros bytes de la entrada son iguales en el grupo y en el .ico;
      // solo cambian el tamaño real y el desplazamiento, que se recalculan.
      const entry = Buffer.alloc(16)
      dir.copy(entry, 0, at, at + 12)
      entry.writeUInt32LE(data.length, 8)
      images.push({ entry, data })
    }
    if (!images.length) return null

    const header = Buffer.alloc(6)
    header.writeUInt16LE(0, 0)
    header.writeUInt16LE(1, 2) // 1 = icono
    header.writeUInt16LE(images.length, 4)

    let offset = 6 + images.length * 16
    for (const img of images) {
      img.entry.writeUInt32LE(offset, 12)
      offset += img.data.length
    }

    return Buffer.concat([header, ...images.map((i) => i.entry), ...images.map((i) => i.data)])
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}

export interface PeOptions {
  /** Buscar cadenas en todo el binario. Cuesta una lectura completa: solo para el ejecutable principal. */
  deepScan?: boolean
}

export async function readPe(filePath: string, opts: PeOptions = {}): Promise<PeInfo | null> {
  let fh: FileHandle | null = null
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size < 512) return null
    fh = await open(filePath, 'r')

    const head = await readAt(fh, 0, 1024)
    if (head.length < 64 || head.readUInt16LE(0) !== 0x5a4d) return null // "MZ"

    const peOffset = head.readUInt32LE(0x3c)
    if (peOffset <= 0 || peOffset > info.size - 24) return null

    const coff = await readAt(fh, peOffset, 24)
    if (coff.length < 24 || coff.readUInt32LE(0) !== 0x00004550) return null // "PE\0\0"

    const machine = coff.readUInt16LE(4)
    const sectionCount = coff.readUInt16LE(6)
    const timeDateStamp = coff.readUInt32LE(8)
    const optSize = coff.readUInt16LE(20)
    const characteristics = coff.readUInt16LE(22)

    const optOffset = peOffset + 24
    const opt = await readAt(fh, optOffset, Math.min(optSize, 256))
    const magic = opt.length >= 2 ? opt.readUInt16LE(0) : 0
    const plus = magic === 0x20b
    const dirOffset = plus ? 112 : 96
    const dirCount = opt.length >= dirOffset - 4 ? opt.readUInt32LE(plus ? 108 : 92) : 0

    const dir = (i: number): { rva: number; size: number } => {
      const at = dirOffset + i * 8
      if (i >= dirCount || at + 8 > opt.length) return { rva: 0, size: 0 }
      return { rva: opt.readUInt32LE(at), size: opt.readUInt32LE(at + 4) }
    }

    const secBuf = await readAt(fh, optOffset + optSize, sectionCount * 40)
    const sections: Section[] = []
    for (let i = 0; i < sectionCount; i++) {
      const o = i * 40
      if (o + 40 > secBuf.length) break
      sections.push({
        name: readCString(secBuf, o, 8),
        virtualSize: secBuf.readUInt32LE(o + 8),
        virtualAddress: secBuf.readUInt32LE(o + 12),
        rawSize: secBuf.readUInt32LE(o + 16),
        rawPointer: secBuf.readUInt32LE(o + 20)
      })
    }

    const result: PeInfo = {
      arch: MACHINE[machine] ?? 'desconocida',
      isDll: (characteristics & 0x2000) !== 0,
      imports: [],
      dynamicHints: [],
      hasEmbeddedSignature: dir(4).size > 0,
      timestamp: timeDateStamp > 0 ? new Date(timeDateStamp * 1000).toISOString() : undefined
    }

    // --- Importaciones ---
    const importDir = dir(1)
    const importOffset = importDir.rva ? rvaToOffset(sections, importDir.rva) : null
    if (importOffset != null) {
      const table = await readAt(fh, importOffset, Math.min(importDir.size || 4096, 64 * 1024))
      for (let i = 0; i + 20 <= table.length; i += 20) {
        const nameRva = table.readUInt32LE(i + 12)
        if (nameRva === 0 && table.readUInt32LE(i) === 0) break
        const nameOffset = rvaToOffset(sections, nameRva)
        if (nameOffset == null) continue
        const nameBuf = await readAt(fh, nameOffset, 128)
        const name = readCString(nameBuf, 0)
        if (name) result.imports.push(name.toLowerCase())
      }
    }

    // --- VERSIONINFO ---
    const resDir = dir(2)
    const resOffset = resDir.rva ? rvaToOffset(sections, resDir.rva) : null
    if (resOffset != null && resDir.size > 0 && resDir.size < 16 * 1024 * 1024) {
      const res = await readAt(fh, resOffset, resDir.size)
      const entry = findVersionResource(res)
      if (entry && entry.size > 0 && entry.size < 1024 * 1024) {
        const vOffset = rvaToOffset(sections, entry.rva)
        if (vOffset != null) {
          const strings = parseVersionInfo(await readAt(fh, vOffset, entry.size))
          result.companyName = strings['CompanyName'] || undefined
          result.productName = strings['ProductName'] || undefined
          result.fileDescription = strings['FileDescription'] || undefined
          result.fileVersion = strings['FileVersion'] || undefined
          result.originalFilename = strings['OriginalFilename'] || undefined
        }
      }
    }

    // --- Cadenas, solo bajo petición ---
    if (opts.deepScan && info.size < 600 * 1024 * 1024) {
      result.dynamicHints = await findStrings(fh, info.size, API_NEEDLES)
    }

    return result
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}
