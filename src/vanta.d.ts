import type { VantaApi } from '../electron/preload'

declare global {
  interface Window {
    vanta: VantaApi
  }
}

export {}
