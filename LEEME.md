# VANTA

Control de integridad de carpetas de juego. Este primer bloque detecta lo que
tienes instalado, fija la línea base de cada juego y saca su ficha técnica.

**Nada se borra sin que lo pidas dos veces.** La purga mueve archivos a una
cuarentena reversible. La única función que borra de verdad es el vaciado
manual de un lote, y pide confirmación aparte.

## Instalación

1. Instala **Node.js LTS** desde <https://nodejs.org> si no lo tienes.
2. Descomprime esta carpeta donde quieras (por ejemplo `C:\VANTA`).
3. Doble clic en **INSTALAR.bat**. Tarda unos minutos la primera vez porque
   descarga Electron.
4. Doble clic en **VANTA.bat**.

`RECOMPILAR.bat` es para cuando te pase cambios: vuelve a compilar sin reinstalar.
`PROBAR.bat` ejecuta la batería de pruebas de los servicios: monta juegos
simulados en una carpeta temporal y recorre todo lo que hace VANTA sin abrir
la aplicación. Si sale «TODO CORRECTO», el motor está sano.

## Qué hace ya

- **Encuentra tus juegos** leyendo el inventario de Steam (`libraryfolders.vdf`
  y los `appmanifest_*.acf`), los manifiestos de Epic y el registro de GOG.
  Xbox y Game Pass todavía no, hay que añadirlos con «Añadir carpeta».
- **Fija la línea base**: recorre la carpeta hasta el último archivo, calcula
  SHA-256 de todos y guarda ruta, tamaño, fecha y huella.
- **Detecta la API gráfica** leyendo la tabla de importaciones del ejecutable, y
  si el juego carga la API dinámicamente, buscando las cadenas dentro del
  binario. Cada conclusión viene con su nivel de confianza y su motivo.
- **Identifica el motor**, la arquitectura, el editor declarado, la fecha de
  compilación y si el ejecutable lleva firma incrustada.
- **Avisa del anticheat**. Si encuentra Easy Anti-Cheat o BattlEye lo dice en
  rojo, porque modificar esos juegos puede costarte la cuenta.
- **Señala las DLL proxy** de la raíz (dxgi.dll, d3d11.dll, dinput8.dll...) y
  lee sus datos de versión, que suelen decir literalmente si son ReShade, ENB o
  DXVK.
- **Propone las carpetas externas** del juego en Documentos y AppData, y marca
  como protegidas las que contienen partidas guardadas.
- **Detecta actualizaciones del juego** comparando el `buildid` de Steam con el
  que había cuando se fijó la línea base, y te avisa antes de que confundas un
  parche con un mod.
- **Vuelve a analizar la ficha sin rehacer la línea base.** Cuando se añaden
  reglas nuevas de motor o de API, el botón de la ficha técnica las aplica
  sobre la lista de archivos ya guardada, en un segundo.

## Dónde se guardan los datos

En `%APPDATA%\VANTA`, fuera de la carpeta del programa:

```
library.json              la lista de juegos y sus fichas
baselines\<id>.json.gz    la línea base de cada juego, comprimida
```

Actualizar VANTA nunca toca esa carpeta.

## Nota técnica

El hash es SHA-256 con el módulo `crypto` de Node en lugar de BLAKE3. En estas
CPU va a un par de gigas por segundo, muy por encima de lo que da cualquier
disco, así que el cuello de botella sigue siendo la lectura. A cambio se evita
una dependencia nativa que habría que recompilar en cada actualización de
Electron.

## De dónde salen las carátulas

Tres fuentes, todas locales, sin pedirle nada a internet:

1. **La caché de arte de Steam.** El cliente ya se ha descargado la carátula
   vertical, la cabecera y el icono de cada juego instalado. VANTA los lee de
   `appcache\librarycache` y admite tanto la disposición nueva (una subcarpeta
   por juego) como la antigua (todo plano).
2. **El `.ico` de la carpeta del juego**, que es lo que deja GOG.
3. **El icono incrustado en el ejecutable**, extraído de sus recursos PE.

De Steam se cogen cuatro piezas: la carátula vertical para la lista, la
cabecera como fondo de la ficha, el logotipo recortado para el título y el
icono. Si no hay nada de eso, se dibuja un recuadro con las iniciales y un
tinte estable derivado del nombre. En la ficha técnica hay un botón para
volver a buscarla.

Lo encontrado se copia a `%APPDATA%\VANTA\art` y se sirve por un esquema
propio, así que no depende de que Steam mantenga su caché.

## El ciclo de trabajo

1. **Fija la línea base** con el juego limpio. VANTA guarda huella, tamaño y
   fecha de cada archivo, y copia aparte los originales pequeños (configs, DLL,
   ejecutables y scripts de menos de 20 MB) por si un mod los sobrescribe.
2. **Trastea lo que quieras**: mods, ReShade, DLL sueltas, lo que sea.
3. **Buscar cambios**. Compara el disco contra la línea base y solo relee los
   archivos cuyo tamaño o fecha no cuadran, así que tarda segundos aunque el
   juego pese 100 GB. La verificación profunda recalcula todo, por si un mod
   sobrescribió conservando la fecha.
4. **Revisa los grupos**. Lo que VANTA reconoce sale ya agrupado y con su
   color. Lo que no, aparece como «Sin identificar» y te pregunta qué es. Si se
   lo dices y marcas recordarlo, la próxima vez ya lo agrupa solo. La regla
   que aprende es la carpeta más corta que sea solo de ese mod: si el mod vive
   en `TexturasHD\`, aprende la carpeta; si dejó archivos en `Data\`, donde
   hay de todo, aprende los archivos exactos y no se traga nada ajeno.
5. **Purga** un grupo o del todo. Los archivos se mueven a cuarentena, no se
   borran, y en la pestaña de cuarentena puedes devolverlos cuando quieras.

## Emparejado por huella

Muchos parcheadores no borran nada: renombran el original a `.BAK` y ponen el
suyo. Desde fuera parece un archivo desaparecido y otro nuevo sin relación.

VANTA compara la huella del archivo nuevo con la de los originales de la línea
base. Si coincide bit a bit, no hay que suponer nada: es el mismo archivo con
otro nombre. Entonces los agrupa juntos, bloquea la purga de ese grupo (borrar
el `.BAK` destruiría el único ejemplar del original) y ofrece deshacer el
renombrado.

Lo mismo con las copias: si un `.BAK` tiene el contenido exacto de un original
que sigue en su sitio, es un respaldo redundante y se puede purgar sin riesgo.
Y si ese original ha sido sobrescrito, VANTA sabe que puede recuperarlo desde
el `.BAK` aunque no tenga copia propia.

## Panel lateral

En pantallas anchas aparece a la derecha un resumen permanente del juego:
carátula grande, estado de la línea base, cambios pendientes, qué perfiles
hay montados, qué hay en cuarentena y la actividad reciente. Es para no tener
que cambiar de pestaña para saber en qué estado está el juego.

## Perfiles

Un perfil es un conjunto de archivos con nombre y color. Se crea desde
cualquier grupo de la pestaña de cambios. Montarlo significa ponerlos en la
carpeta del juego; desmontarlo, apartarlos a un almacén en la misma unidad.
Como es mover y no copiar, alternar es instantáneo aunque el perfil pese cien
megas.

Puedes tener varios montados a la vez. El botón de jugar ofrece tres cosas:
tal como está ahora, limpio (desmonta todo), o con un perfil concreto
(desmonta el resto y monta ese). Y si quieres, al cerrar el juego VANTA
desmonta todo solo y te deja la carpeta como recién instalada.

Montar nunca pisa nada: si ya existe un archivo con ese nombre, se salta y te
lo dice. Y si vas a rehacer la línea base con perfiles montados, VANTA te
avisa y ofrece desmontarlos antes: si no, ReShade quedaría fijado como parte
del juego original y ya no podrías purgarlo nunca. Y al eliminar un perfil sus archivos vuelven a la carpeta del juego,
para que VANTA no se quede con nada tuyo escondido.

## Vortex

Vortex escribe un `vortex.deployment.json` en la carpeta donde despliega, con
cada archivo que ha puesto y de qué mod salió. VANTA lo lee, así que en vez de
un montón de archivos sin identificar ves un grupo por mod, con su nombre real
y sin los sufijos de Nexus.

Mod Organizer 2 funciona al revés: no escribe nada en la carpeta del juego,
usa un sistema de archivos virtual que solo existe mientras el juego corre. No
hay nada suyo que VANTA tenga que limpiar.

## Conflictos

Si un mod sobrescribe archivos originales del juego, la pestaña de cambios lo
avisa y dice cuántos ha pisado y cuántos se pueden recuperar. Cuando dos mods
tocan el mismo archivo gana el último que instalaste, y esa es la causa más
común de que algo deje de funcionar sin motivo aparente.

## Historial e informes

Cada revisión queda anotada con la fecha, el modo y lo que había. También las
partidas, con qué perfiles tenías montados. Y hay un botón para exportar todo
a Markdown: ficha técnica, línea base, lo que tienes puesto encima, las
sobrescrituras y los perfiles. Para pegarlo cuando pidas ayuda en un foro.

## Configuraciones clave por clave

Un archivo de ajustes no se compara como un binario. Los juegos reescriben sus
`.ini` y `.xml` cada vez que tocas el volumen, así que saber que el archivo
cambió no dice nada: hay que saber qué clave cambió y de qué valor a cuál.

En la lista de archivos de cualquier grupo, los de configuración tienen un
botón que abre la comparación. Ahí ves las claves cambiadas, las nuevas y las
que han desaparecido, con el valor de antes y el de ahora. Puedes comparar
contra la versión de fábrica o contra cualquiera de las guardadas.

Y puedes **revertir claves sueltas**, no el archivo entero. Si un parcheador te
cambió el campo de visión, las sombras y el nivel de detalle, puedes devolver
solo el campo de visión y quedarte con lo demás.

Formatos: `.ini`, `.cfg`, `.conf`, `.properties`, `.settings`, `.prefs`,
`.toml`, `.xml` y `.json`. La reversión clave a clave funciona en los de tipo
INI y en XML, donde se edita solo el trozo exacto del valor y se conservan
comentarios, sangrado y orden byte a byte. En JSON solo se puede ver la
comparación, porque devolver una clave obligaría a reescribir el archivo entero
y perderías el formato.

**Antes de escribir, VANTA vuelve a analizar el resultado** y comprueba que la
clave tocada tiene el valor pedido y que ninguna otra se ha movido. Si algo no
cuadra, no escribe nada y te lo dice.

## Ajustes en el registro de Windows

Muchos juegos hechos con Unity no guardan sus opciones en archivos sino en
`HKCU\Software\<Empresa>\<Juego>`. VANTA deduce esa clave de los datos de
versión del ejecutable, la vuelca y la archiva como una configuración más, así
que la comparación clave por clave funciona también ahí.

Es de solo lectura. VANTA nunca escribe en el registro.

## Ajustes

El botón de la barra superior abre dónde guarda VANTA sus cosas, cuánto ocupa
cada parte y la lista de reglas que le has enseñado, con la opción de olvidar
cualquiera si te equivocaste al nombrar un grupo.

## Qué protege VANTA pase lo que pase

- **Partidas guardadas.** Detectadas por carpeta y por extensión, salen con
  candado y ni la purga total las toca.
- **Cualquier carpeta que marques como protegida** en la pestaña de resumen.
- **Los originales sobrescritos sin copia de seguridad.** Borrarlos dejaría un
  hueco en el juego, así que se quedan y te avisa de que uses la verificación
  de integridad de la tienda.
- **Lo que ya no está.** Los archivos de la línea base que han desaparecido van
  a su propio grupo, sin opción de purga, porque no hay nada que purgar.
- **Lo tuyo al quitar un juego.** Antes de olvidarlo, los perfiles desmontados
  vuelven a la carpeta del juego y te ofrece devolver también lo que tengas en
  cuarentena. VANTA no se queda con archivos en almacenes que ya nadie mira.

## Qué identifica solo

ReShade, ENBSeries, SweetFX, DXVK, VKD3D, dgVoodoo, Special K, Ultimate ASI
Loader, script extenders (SKSE, F4SE, NVSE, SFSE), BepInEx, MelonLoader,
RED4ext, REFramework, sustituciones de DLSS, FSR y OptiScaler, Vortex, Mod
Organizer 2, plugins de Bethesda, paks de Unreal, RenderDoc, entrenadores y
registros de volcado.

Una DLL suelta en la raíz con nombre de librería del sistema (dxgi.dll,
d3d11.dll, dinput8.dll...) que no se identifique se marca como inyector sin
identificar, no como archivo cualquiera. Es la señal más clara de que algo se
está metiendo en el juego. Y si esa DLL no lleva datos de versión pero a su
lado están los archivos característicos del programa que se carga por ella
(REFramework con su `dinput8.dll`, por ejemplo), se le atribuye a él.

## Dónde va cada cosa

```
%APPDATA%\VANTA\
  library.json              juegos y fichas
  baselines\<id>.json.gz    líneas base
  reports\<id>.json.gz      última revisión de cambios
  originals\<id>\...        copia de los originales pequeños
  quarantine.json           índice de lotes en cuarentena
  rules.json                lo que le has enseñado

<raíz de cada unidad>\.vanta-cuarentena\
  los archivos purgados, con su manifiesto
```

La cuarentena vive en la misma unidad que el archivo para que mover sea un
renombrado instantáneo en lugar de copiar gigas entre discos.

## Dónde va cada cosa

```
%APPDATA%\VANTA\
  library.json              juegos y fichas
  baselines\<id>.json.gz    líneas base
  reports\<id>.json.gz      última revisión de cambios
  history\<id>.json         historial de revisiones y partidas
  originals\<id>\...        copia de los originales pequeños
  configs\<id>\             versiones de cada archivo de ajustes
  profiles.json             perfiles
  quarantine.json           índice de lotes en cuarentena
  rules.json                lo que le has enseñado
  art\                      carátulas e iconos

<raíz de cada unidad>\.vanta-cuarentena\   archivos purgados
<raíz de cada unidad>\.vanta-perfiles\     archivos de perfiles desmontados
```

## Publicar versiones y actualización automática

Hay dos formas de usar VANTA: con `VANTA.bat` (para trastear con el código) o
**instalada**, que es la que se actualiza sola.

Para publicar una versión hace falta tener instalados Git y la consola de
GitHub. Se instalan una vez desde una consola:

```
winget install --id Git.Git -e
winget install --id GitHub.cli -e
```

Después, doble clic en **PUBLICAR.bat**. La primera vez abre el navegador para
iniciar sesión en GitHub y crea el repositorio `vanta` en tu cuenta. Cada vez
pregunta el número de versión nueva, sube el código, compila el instalador y
publica la release. Al terminar tienes `dist-installer\VANTA-Setup-x.y.z.exe`.

Instala ese `.exe` una vez. A partir de ahí, la app instalada comprueba al
arrancar si hay una versión más nueva en tus releases, la descarga en segundo
plano y te pide reiniciar. También puedes buscarla a mano desde Ajustes. Tus
datos no corren peligro: viven en `%APPDATA%\VANTA` y el instalador solo toca
la carpeta del programa.

El repositorio se crea público porque la actualización automática lee las
releases sin contraseña; con uno privado haría falta meter una clave dentro de
la app, que es peor idea. No hay nada en el código que no puedas enseñar.

Windows SmartScreen avisará la primera vez que ejecutes el instalador porque
no está firmado. «Más información» y «Ejecutar de todas formas».

## Pendiente

Nada. Lo que salga de usarla.
