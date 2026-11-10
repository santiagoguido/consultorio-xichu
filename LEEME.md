# Consultorio ISSSTE (app local para iPad)

App web instalable (PWA). Funciona sin internet y **todos los datos se quedan en el iPad** (IndexedDB). No hay servidor, base de datos externa ni costos.

## Publicarla gratis en GitHub Pages (una sola vez)

1. Crea un repositorio en GitHub (puede ser privado si tu plan lo permite con Pages; si no, público: el repo solo tiene el código, nunca datos de pacientes).
2. Sube **el contenido de esta carpeta** a la raíz del repositorio (index.html, app.js, app.css, vivo.js, vivo.css, vivo-worklet.js, vivo-whisper.js, suive.js, frases.js, sw.js, manifest.webmanifest, carpetas `icons/` y `vendor/`, incluida `vendor/transformers/`).
3. En el repo: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
4. En un minuto tendrás una URL tipo `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

## Instalarla en el iPad

1. Abre la URL en **Safari**.
2. Botón Compartir → **Agregar a pantalla de inicio**.
3. Ábrela **siempre desde el ícono**. (Los datos del ícono y los de Safari son independientes.)
4. Después de abrirla una vez con internet, funciona en modo avión.

## Importar pacientes

- Ajustes → **Importar pacientes** (o el botón en Pacientes cuando la lista está vacía) y elige el archivo `.json` de pacientes.
- No borra nada: si el paciente ya existe (mismo nombre y expediente), solo completa los datos que le falten. Puedes importarlo dos veces sin duplicar.
- **Nunca subas ese archivo a GitHub**: contiene datos de pacientes. Pásalo al iPad por AirDrop, correo o Archivos.

## Respaldos

- Ajustes → **Guardar respaldo** genera un `.json`; guárdalo en Archivos / iCloud Drive cada semana.
- Para pasar los datos a otro iPad: instala la app ahí y usa **Restaurar respaldo**.

## Actualizar la app

Si cambias cualquier archivo, sube también `sw.js` con el número de versión aumentado (`consultorio-v9` → `consultorio-v10`, etc.). Al abrir la app dos veces, el iPad toma la versión nueva. Los datos no se tocan y el modelo de voz ya descargado se conserva.

## Dos consultorios, datos separados

- La app guarda **ISSSTE** y **Consultorio particular** en dos bases distintas dentro del iPad. Pacientes, consultas, reportes y ajustes de uno nunca aparecen en el otro.
- El consultorio activo se ve en la pastilla del menú y en «Hoy» («Estás en…»). Tócala para cambiar.
- Lo que ya estaba capturado sigue en ISSSTE, sin cambios.
- Cada consultorio tiene su propio respaldo (el archivo lleva su nombre: `Respaldo_issste_…` o `Respaldo_particular_…`). Haz los dos.
- El PIN es uno solo para ambos.

## Consulta en vivo (asistente)

1. Crea una clave gratuita en Google AI Studio (aistudio.google.com → «Get API key»).
2. En la app: **Ajustes → Consulta en vivo** → pega la clave → **Ver modelos** → elige uno «flash» → **Probar conexión**.
3. En la misma tarjeta, sección **Transcripción de la voz**: deja «En el iPad», elige el modelo de voz y toca **Preparar transcripción**. Descarga el modelo una sola vez (con buen internet) y lo guarda en el iPad. Luego toca **Probar con mi voz (5 s)** para ver qué entiende y cuánto tarda.
4. En «Hoy» toca **Iniciar consulta en vivo**: eliges consultorio, paciente, confirmas el consentimiento y la tableta empieza a escuchar.
5. Mientras conversan se llenan la historia clínica, las sugerencias y la receta. Lo que la doctora dice que va a recetar entra solo; lo que propone el asistente espera a que ella lo acepte.
6. **Finalizar consulta** muestra la nota para revisarla; **Guardar consulta** abre la hoja de consulta de siempre, ya llena, para completar lo que falte y guardar.

Sin clave puedes ver cómo funciona con **Ver demostración** (consulta ficticia, sin micrófono ni internet).

### Cómo funciona ahora (transcripción en el iPad)

- El micrófono graba sin parar. La app corta la voz en las pausas (fragmentos de 4 a 28 segundos) y la **transcribe en el propio iPad** con Whisper. Lo que se va oyendo aparece en pantalla de inmediato como «Recién oído».
- A Gemini **solo se le envía el texto** (unos pocos KB en lugar de cientos de KB de audio), agrupado para no pasar de un análisis cada 20 segundos (se cambia en Ajustes: 10, 20 o 40 s). Gemini devuelve quién habló, la historia, las sugerencias y la receta.
- **Si se va el internet, se sigue escuchando y transcribiendo.** El texto se queda en espera y se analiza todo junto cuando vuelve la conexión: no se pierde nada.
- **Respaldo:** si el modelo de voz no está preparado, se está cargando o falla, ese fragmento se envía como audio a Gemini, igual que antes. También puedes elegir «Enviar audio a Gemini» en Ajustes.
- **Modelos de voz:** «Rápido» (Whisper base, unos 207 MB con GPU) y «Preciso» (Whisper small, unos 586 MB con GPU; entiende mejor el español, pero ocupa más memoria). Empieza con «Rápido»; si se equivoca mucho, prepara «Preciso» y compáralos con **Probar con mi voz**. Sin GPU se descargan versiones más ligeras (77 y 249 MB) y es más lento.
- **«Respuesta de Gemini: Rápida»** le pide al modelo razonar poco para contestar antes. Si notas sugerencias pobres, cambia a «Más razonada».
- Requisitos: iPad con iPadOS 26 o posterior para usar la GPU (WebGPU). La primera preparación necesita internet (el modelo viene de huggingface.co y el motor de cdn.jsdelivr.net); después funciona con lo guardado. Abre la app siempre desde el ícono de la pantalla de inicio para que el iPad no borre esa descarga.

### Semáforo: ¿está funcionando todo?

- **En «Hoy»**, el botón «Iniciar consulta en vivo» muestra el estado: **verde «Todo listo»**, **ámbar** si funciona con una limitación (por ejemplo, transcripción sin preparar: enviará audio) y **rojo** si no puede funcionar (sin internet, sin clave, clave inválida, micrófono sin permiso). Se revisa al entrar, cada dos minutos y al cambiar la conexión.
- **Durante la consulta**, junto al cronómetro hay una pastilla: **verde «Todo en orden»**; si algo falla cambia a ámbar o rojo, aparece una franja arriba que dice qué pasa y qué hacer, y suena un aviso doble si la falla dura más de 5 segundos (se puede apagar en Ajustes). Vigila: micrófono (si deja de entregar audio), transcripción en el iPad, internet, respuesta de Gemini (límite del plan, clave, errores) y análisis atrasado. Al tocar la pastilla se ve el detalle de cada parte.
- Cuando la falla se resuelve, vuelve a verde sola y avisa «Todo en orden otra vez».

Cosas que conviene saber:

- **El audio no se guarda.** Con la transcripción en el iPad, el audio ni siquiera sale del dispositivo. Tampoco se guarda la transcripción: queda solo la nota.
- **La clave gratuita es para consultas simuladas.** Con el plan gratuito, Google puede usar lo enviado (ahora texto) para mejorar sus productos. Para pacientes reales activa la facturación en el proyecto de Google; la app no cambia.
- **La clave vive solo en el iPad**: no está en el código, no se sube a GitHub y no viaja en los respaldos. Si restauras en otro iPad, vuelve a pegarla y vuelve a preparar la transcripción.
- **El nombre del paciente no se envía** como dato al modelo (sí puede aparecer en el texto si alguien lo dice).
- **Whisper puede equivocarse** en nombres de medicamentos, dosis y cifras. Gemini corrige lo evidente por contexto y marca lo dudoso como «por confirmar», pero la receta y la nota siempre deben revisarse antes de guardar.
- **Las sugerencias son apoyo, no indicación.** Todavía no hay guías clínicas cargadas en la app: el modelo responde con su conocimiento general y así lo indica.
- **Receta:** en el consultorio particular se genera en Word con los datos fijos de Ajustes → «Receta médica (plantilla)». En ISSSTE solo hay una lista de apoyo para llenar el formato institucional. Los medicamentos controlados se marcan y no entran a la plantilla.
- Mantén la app abierta y en pantalla durante la consulta: si el iPad se bloquea o cambias de app, deja de escuchar (el semáforo lo marca en rojo al volver). Conviene tenerlo conectado a la corriente: transcribir gasta batería.

## Notas

- Catálogo SUIVE: basado en el formato SUIVE-1; revisa claves y nombres contra el formato vigente de la jurisdicción (Ajustes → Catálogo SUIVE).
- Semana epidemiológica: domingo a sábado; la semana 1 termina el primer sábado de enero con al menos 4 días del año.
- Librerías incluidas localmente: jsPDF, jspdf-autotable y docx (licencia MIT); Transformers.js de Hugging Face (licencia Apache 2.0) en `vendor/transformers/`. Los modelos de voz Whisper (OpenAI, licencia MIT) se descargan de `onnx-community` en Hugging Face al prepararlos.
