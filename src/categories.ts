/**
 * Etiquetas, colores y explicaciones de cada categoría de archivo. Es el único
 * sitio donde un color saturado significa algo en toda la interfaz.
 */

import type { Category } from '../shared/types'

export const CATEGORY: Record<Category, { label: string; color: string; hint: string }> = {
  desconocido: {
    label: 'Sin identificar',
    color: 'var(--c-unknown)',
    hint: 'Apareció desde la última revisión y VANTA no sabe qué es.'
  },
  postproceso: {
    label: 'Post-procesado',
    color: 'var(--c-post)',
    hint: 'Filtros de imagen: ReShade, ENB, SweetFX.'
  },
  'traduccion-api': {
    label: 'Traducción de API',
    color: 'var(--c-api)',
    hint: 'Traduce llamadas gráficas: DXVK, VKD3D, dgVoodoo.'
  },
  cargador: {
    label: 'Cargador o inyector',
    color: 'var(--c-loader)',
    hint: 'Carga otros mods al arrancar: BepInEx, script extenders, ASI.'
  },
  contenido: {
    label: 'Mod de contenido',
    color: 'var(--c-content)',
    hint: 'Añade o cambia cosas del juego: texturas, misiones, objetos.'
  },
  gestor: {
    label: 'Gestor de mods',
    color: 'var(--c-manager)',
    hint: 'Archivos que pone Vortex o Mod Organizer. Púrgalos desde el gestor.'
  },
  herramienta: {
    label: 'Herramienta',
    color: 'var(--c-tool)',
    hint: 'Utilidades y registros: depuradores, entrenadores, logs.'
  },
  configuracion: {
    label: 'Configuración',
    color: 'var(--c-config)',
    hint: 'Ajustes que han cambiado. Casi siempre los reescribe el propio juego.'
  },
  respaldo: {
    label: 'Respaldo de un original',
    color: '#2dd4bf',
    hint: 'Su huella coincide bit a bit con un archivo original del juego.'
  },
  ausente: {
    label: 'Original que falta',
    color: '#f97316',
    hint: 'Estaba en la línea base y ya no está. Verifica la integridad en la tienda.'
  },
  partida: {
    label: 'Partida guardada',
    color: 'var(--c-save)',
    hint: 'Protegido. VANTA no lo toca nunca.'
  }
}

export const CATEGORY_ORDER: Category[] = [
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
