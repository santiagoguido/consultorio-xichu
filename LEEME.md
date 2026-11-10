# Consultorio ISSSTE (app local para iPad)

App web instalable (PWA). Funciona sin internet y **todos los datos se quedan en el iPad** (IndexedDB). No hay servidor, base de datos externa ni costos.

## Publicarla gratis en GitHub Pages (una sola vez)

1. Crea un repositorio en GitHub (puede ser privado si tu plan lo permite con Pages; si no, público: el repo solo tiene el código, nunca datos de pacientes).
2. Sube **el contenido de esta carpeta** a la raíz del repositorio (index.html, app.js, app.css, vivo.js, vivo.css, vivo-worklet.js, suive.js, frases.js, sw.js, manifest.webmanifest, carpetas `icons/` y `vendor/`).
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

Si cambias cualquier archivo, sube también `sw.js` con el número de versión aumentado (`consultorio-v8` → `consultorio-v9`, etc.). Al abrir la app dos veces, el iPad toma la versión nueva. Los datos no se tocan.

## Dos consultorios, datos separados

- La app guarda **ISSSTE** y **Consultorio particular** en dos bases distintas dentro del iPad. Pacientes, consultas, reportes y ajustes de uno nunca aparecen en el otro.
- El consultorio activo se ve en la pastilla del menú y en «Hoy» («Estás en…»). Tócala para cambiar.
- Lo que ya estaba capturado sigue en ISSSTE, sin cambios.
- Cada consultorio tiene su propio respaldo (el archivo lleva su nombre: `Respaldo_issste_…` o `Respaldo_particular_…`). Haz los dos.
- El PIN es uno solo para ambos.

## Consulta en vivo (asistente)

1. Crea una clave gratuita en Google AI Studio (aistudio.google.com → «Get API key»).
2. En la app: **Ajustes → Consulta en vivo** → pega la clave → **Ver modelos** → elige uno «flash» → **Probar conexión**.
3. En «Hoy» toca **Iniciar consulta en vivo**: eliges consultorio, paciente, confirmas el consentimiento y la tableta empieza a escuchar.
4. Mientras conversan se llenan la historia clínica, las sugerencias y la receta. Lo que la doctora dice que va a recetar entra solo; lo que propone el asistente espera a que ella lo acepte.
5. **Finalizar consulta** muestra la nota para revisarla; **Guardar consulta** abre la hoja de consulta de siempre, ya llena, para completar lo que falte y guardar.

Sin clave puedes ver cómo funciona con **Ver demostración** (consulta ficticia, sin micrófono ni internet).

Cosas que conviene saber:

- **El audio no se guarda.** Se envía a Gemini en fragmentos de 15 a 30 segundos y se descarta. Tampoco se guarda la transcripción: queda solo la nota.
- **La clave gratuita es para consultas simuladas.** Con el plan gratuito, Google puede usar lo enviado para mejorar sus productos. Para pacientes reales activa la facturación en el proyecto de Google; la app no cambia.
- **La clave vive solo en el iPad**: no está en el código, no se sube a GitHub y no viaja en los respaldos. Si restauras en otro iPad, vuelve a pegarla.
- **El nombre del paciente no se envía** al modelo (sí puede oírse en el audio si alguien lo dice).
- **Las sugerencias son apoyo, no indicación.** Todavía no hay guías clínicas cargadas en la app: el modelo responde con su conocimiento general y así lo indica.
- **Receta:** en el consultorio particular se genera en Word con los datos fijos de Ajustes → «Receta médica (plantilla)». En ISSSTE solo hay una lista de apoyo para llenar el formato institucional. Los medicamentos controlados se marcan y no entran a la plantilla.
- Mantén la app abierta y en pantalla durante la consulta: si el iPad se bloquea o cambias de app, deja de escuchar.

## Notas

- Catálogo SUIVE: basado en el formato SUIVE-1; revisa claves y nombres contra el formato vigente de la jurisdicción (Ajustes → Catálogo SUIVE).
- Semana epidemiológica: domingo a sábado; la semana 1 termina el primer sábado de enero con al menos 4 días del año.
- Librerías incluidas localmente: jsPDF, jspdf-autotable y docx (licencia MIT).
