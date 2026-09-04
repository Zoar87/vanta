import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info'
}

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' })
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' })
await build({ ...common, entryPoints: ['electron/services/hashWorker.ts'], outfile: 'dist-electron/hashWorker.js' })
