/**
 * Tipos compartidos entre el proceso principal y la interfaz.
 *
 * Todo lo que viaja por IPC o se guarda en disco tiene aquí su forma. Si un
 * campo es opcional es porque puede faltar en datos guardados por versiones
 * anteriores de VANTA, y el código lo trata como ausente sin quejarse.
 */

export type Platform = 'steam' | 'epic' | 'gog' | 'manual'

export type GraphicsApi = 'dx9' | 'dx10' | 'dx11' | 'dx12' | 'vulkan' | 'opengl'

export type Confidence = 'alta' | 'media' | 'baja'

export interface ApiFinding {
  api: GraphicsApi
  confidence: Confidence
  /** De dónde sale la conclusión, en lenguaje llano. */
  evidence: string[]
}

export interface AntiCheatFinding {
  name: string
  evidence: string
}

/** Datos extraídos de la cabecera PE de un ejecutable o DLL de Windows. */
export interface PeInfo {
  arch: 'x64' | 'x86' | 'arm64' | 'desconocida'
  isDll: boolean
  /** Módulos que importa de forma estática. */
  imports: string[]
  /** Cadenas encontradas por búsqueda directa cuando la carga es dinámica. */
  dynamicHints: string[]
  companyName?: string
  productName?: string
  fileDescription?: string
  fileVersion?: string
  originalFilename?: string
  /** Tiene tabla de certificados incrustada (firma Authenticode en el propio archivo). */
  hasEmbeddedSignature: boolean
  /** Fecha de compilación declarada en la cabecera COFF. */
  timestamp?: string
}

export interface GameSpec {
  engine: string
  engineEvidence: string[]
  apis: ApiFinding[]
  arch: string
  mainExecutable?: string
  mainExecutablePe?: PeInfo
  antiCheat: AntiCheatFinding[]
  /** DLL sueltas en la raíz que secuestran una API gráfica (ReShade, ENB, DXVK...). */
  proxyDlls: { file: string; hijacks: string; identifiedAs?: string }[]
  redistributables: string[]
}

export interface Game {
  id: string
  name: string
  path: string
  platform: Platform
  appId?: string
  /** buildid de Steam, para detectar actualizaciones del juego. */
  buildId?: string
  addedAt: string
  spec?: GameSpec
  baseline?: BaselineSummary
  /** Rutas externas vinculadas (Documentos, AppData, gestores de mods). */
  linkedPaths: LinkedPath[]
  color?: string
  art?: GameArt
  /** Clave del registro donde el juego guarda sus ajustes, si los guarda ahí. */
  registryKey?: string
}

export interface GameArt {
  cover?: string
  hero?: string
  logo?: string
  icon?: string
  source: string
  resolvedAt: string
}

export interface LinkedPath {
  path: string
  kind: 'documentos' | 'appdata-local' | 'appdata-roaming' | 'gestor' | 'otra'
  label: string
  protected: boolean
}

export interface BaselineSummary {
  takenAt: string
  fileCount: number
  totalBytes: number
  /** buildid en el momento de tomar la línea base. */
  buildId?: string
  durationMs: number
  /** Archivos que no se pudieron leer (bloqueados o sin permisos). */
  unreadable?: number
  roots: { path: string; fileCount: number; totalBytes: number }[]
}

export interface FileRecord {
  /** Ruta relativa a su raíz, con barras normales. */
  rel: string
  /** Índice de la raíz dentro de BaselineSummary.roots. */
  root: number
  size: number
  mtimeMs: number
  sha256: string
}

export interface Baseline {
  gameId: string
  summary: BaselineSummary
  files: FileRecord[]
}

export interface ScanProgress {
  gameId: string
  phase: 'recorriendo' | 'calculando' | 'analizando' | 'guardando' | 'hecho' | 'cancelado' | 'error'
  filesSeen: number
  filesHashed: number
  bytesHashed: number
  totalBytes: number
  currentPath: string
  message?: string
}

export interface DetectResult {
  games: Omit<Game, 'linkedPaths' | 'addedAt'>[]
  notes: string[]
}

// ============================================================ bloque 2

export type Category =
  | 'postproceso'
  | 'traduccion-api'
  | 'cargador'
  | 'contenido'
  | 'herramienta'
  | 'gestor'
  | 'configuracion'
  | 'respaldo'
  | 'partida'
  | 'ausente'
  | 'desconocido'

export type ChangeStatus = 'nuevo' | 'modificado' | 'desaparecido'

export interface ChangeEntry {
  rel: string
  root: number
  status: ChangeStatus
  size: number
  mtimeMs: number
  sha256?: string
  baselineSha256?: string
  baselineSize?: number
  groupId: string
  /** Copia del original disponible para restaurar. */
  hasOriginal?: boolean
  /** Datos de versión leídos del binario, si los tiene. */
  identity?: string
  /**
   * Emparejamiento por huella con la línea base. Si un archivo nuevo tiene el
   * hash exacto de un original, no es contenido nuevo: es ese original movido
   * o copiado. Es prueba, no suposición.
   */
  pairedWith?: { kind: 'renombrado-desde' | 'renombrado-a' | 'copia-de'; root: number; rel: string }
  /** Ruta de un archivo del propio juego que contiene el original intacto. */
  recoverableFrom?: string
}

export interface FileGroup {
  id: string
  name: string
  category: Category
  kind: 'firma' | 'lote' | 'manual'
  detectedBy?: string
  fileCount: number
  totalBytes: number
  counts: Record<ChangeStatus, number>
  /** Nunca se purga: partidas y rutas marcadas por el usuario. */
  locked: boolean
}

export interface ChangeReport {
  gameId: string
  takenAt: string
  durationMs: number
  baselineTakenAt: string
  buildIdChanged?: { from?: string; to?: string }
  rehashed: number
  /** Archivos que no se pudieron leer en esta revisión. */
  unreadable?: number
  deep: boolean
  entries: ChangeEntry[]
  groups: FileGroup[]
}

export interface QuarantineItem {
  rel: string
  root: number
  from: string
  to: string
  size: number
  sha256?: string
}

export interface QuarantineBatch {
  id: string
  gameId: string
  gameName: string
  createdAt: string
  label: string
  category: Category
  itemCount: number
  totalBytes: number
  storePath: string
  restored?: string
  items: QuarantineItem[]
}

export interface LearnedRule {
  id: string
  /** null = vale para todos los juegos. */
  gameId: string | null
  pattern: string
  name: string
  category: Category
  createdAt: string
}

export interface OriginalsSummary {
  fileCount: number
  totalBytes: number
}

// ============================================================ bloque 3

export interface Profile {
  id: string
  gameId: string
  name: string
  color: string
  note?: string
  /** Si está montado, sus archivos están en la carpeta del juego. */
  mounted: boolean
  createdAt: string
  fileCount: number
  totalBytes: number
  items: { root: number; rel: string; size: number }[]
  /** Dónde duermen los archivos cuando el perfil está desmontado. */
  storePath?: string
}

export interface MountResult {
  moved: number
  bytes: number
  skipped: { rel: string; reason: string }[]
}

export interface RevisionSummary {
  takenAt: string
  deep: boolean
  durationMs: number
  rehashed: number
  totals: { nuevo: number; modificado: number; desaparecido: number }
  groups: { name: string; category: Category; fileCount: number; totalBytes: number }[]
}

export interface LaunchSession {
  at: string
  mode: 'limpio' | 'tal cual' | 'perfil'
  profiles: string[]
}

export interface GameHistory {
  gameId: string
  revisions: RevisionSummary[]
  sessions: LaunchSession[]
}

/** Un grupo que ha sobrescrito archivos originales del juego. */
export interface Conflict {
  groupId: string
  groupName: string
  category: Category
  files: string[]
  /** Cuántos de esos originales se pueden recuperar. */
  recoverable: number
}

export type ConfigFormat = 'ini' | 'xml' | 'json'

export interface ConfigDiff {
  format: ConfigFormat
  /** Si se pueden revertir claves sueltas conservando el formato del archivo. */
  surgical: boolean
  changed: { key: string; from: string; to: string }[]
  added: { key: string; value: string }[]
  removed: { key: string; value: string }[]
  unchanged: number
}

export interface ConfigVersion {
  at: string
  sha256: string
  file: string
  factory?: boolean
}
