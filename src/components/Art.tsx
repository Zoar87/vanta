/**
 * Carátula o icono de un juego. Si no hay arte, o la imagen falla al cargar,
 * dibuja un recuadro con las iniciales y un tinte estable derivado del nombre.
 */

import { useState } from 'react'
import type { Game } from '../../shared/types'

/**
 * El nombre del archivo no cambia al volver a buscar la carátula, así que se
 * le añade la marca de tiempo: sin ella el navegador seguiría enseñando la
 * imagen vieja de su caché.
 */
export const artUrl = (name?: string, version?: string): string | null =>
  name
    ? `vanta://art/${encodeURIComponent(name)}${version ? `?v=${encodeURIComponent(version)}` : ''}`
    : null

/** Las cuatro piezas de arte de un juego, ya con su versión. */
export function artOf(game: { art?: { cover?: string; hero?: string; logo?: string; icon?: string; resolvedAt?: string } }) {
  const v = game.art?.resolvedAt
  return {
    cover: artUrl(game.art?.cover, v),
    hero: artUrl(game.art?.hero, v),
    logo: artUrl(game.art?.logo, v),
    icon: artUrl(game.art?.icon, v),
    /** Sin carátula real, solo hay un icono: no se puede estirar sin que se vea mal. */
    onlyIcon: !game.art?.cover && !!game.art?.icon
  }
}

/** Iniciales del juego, para cuando no hay carátula ni icono. */
function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Tinte estable derivado del nombre. Muy desaturado a propósito: en VANTA el
 * color saturado significa algo, y esto es decoración.
 */
function tint(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h} 22% 24%)`
}

export default function Art({ game, size }: { game: Game; size: 'rail' | 'head' }) {
  const [broken, setBroken] = useState(false)
  const a = artOf(game)
  const src = a.cover ?? a.icon
  if (src && !broken) {
    return (
      <img
        className={`art ${size}`}
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span className={`art ${size} fallback`} style={{ background: tint(game.name) }} aria-hidden>
      {initials(game.name)}
    </span>
  )
}
