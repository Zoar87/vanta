/**
 * Carátula o icono de un juego. Si no hay arte, o la imagen falla al cargar,
 * dibuja un recuadro con las iniciales y un tinte estable derivado del nombre.
 */

import { useState } from 'react'
import type { Game } from '../../shared/types'

export const artUrl = (name?: string): string | null =>
  name ? `vanta://art/${encodeURIComponent(name)}` : null

/** Logotipo recortado del juego, cuando Steam lo tiene cacheado. */
export const logoUrl = (game: { art?: { logo?: string } }): string | null =>
  artUrl(game.art?.logo)

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
  const src = artUrl(game.art?.cover) ?? artUrl(game.art?.icon)
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
