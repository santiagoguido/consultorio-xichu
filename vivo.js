'use strict';
/* =========================================================================
   CONSULTA EN VIVO
   La tableta escucha la consulta sin detener la grabación. La voz se corta
   en las pausas y se transcribe en el propio iPad (Whisper, vivo-whisper.js);
   a Gemini solo se le envía el texto para llenar la historia clínica, las
   sugerencias y la receta. Si la transcripción local no está disponible, se
   envía el audio como antes (respaldo). El audio nunca se guarda.
   Usa utilidades de app.js ($, esc, openSheet, Store, S, AMB…) al ejecutarse.
   ========================================================================= */
const Vivo = (() => {
  const CFG_KEY = 'vivo-cfg';
  const API = 'https://generativelanguage.googleapis.com/v1beta/models';
  /* modo: 'local' transcribe en el iPad · 'audio' envía el audio a Gemini. wmodelo: modelo de voz. wlisto: modelos ya preparados en este iPad.
     seg: duración máxima de un fragmento. cada: segundos mínimos entre análisis de Gemini. rapido: respuesta con poco razonamiento. beep: aviso sonoro. */
  const cfg = { apiKey: '', model: 'gemini-flash-latest', seg: 20, modo: 'local', wmodelo: 'base', wlisto: {}, cada: 20, rapido: true, beep: true };
  let cfgOk = false, ses = null;

  const PRIORITARIOS = ['faringitis y faringoamigdalitis aguda', 'gastroenteritis aguda', 'cistitis e infección de vías urinarias no complicada',
    'gastritis, dispepsia y enfermedad por reflujo gastroesofágico', 'diabetes mellitus tipo 2', 'hipertensión arterial sistémica', 'sobrepeso y obesidad',
    'trastornos de ansiedad', 'depresión', 'valoración preventiva de riesgo cardiovascular'];
  const CAMPOS = [['motivo', 'Motivo de consulta'], ['padecimiento', 'Padecimiento actual'], ['ahf', 'Heredofamiliares'], ['app', 'Personales patológicos'],
    ['ago', 'Gineco-obstétricos'], ['alergias', 'Alergias'], ['medicamentos', 'Medicamentos actuales'], ['estudios', 'Estudios previos'], ['exploracion', 'Exploración física']];
  const LBL = Object.fromEntries(CAMPOS);
  const SV = [['ta', 'TA'], ['fc', 'FC'], ['fr', 'FR'], ['temp', 'Temp °C'], ['sat', 'SpO₂ %'], ['peso', 'Peso kg'], ['talla', 'Talla m'], ['gluc', 'Glucosa']];
  const QUIEN = { medico: 'Médico', paciente: 'Paciente', acompanante: 'Acompañante', desconocido: 'Voz' };
  const NIVEL = { alto: 4, medio: 3, bajo: 2, descartar: 0 };
  const CONTROLADOS = /\b(clonazepam|alprazolam|diazepam|lorazepam|bromazepam|midazolam|triazolam|clobazam|zolpidem|tramadol|morfina|code[ií]na|oxicodona|fentanilo|buprenorfina|tapentadol|metilfenidato|fenobarbital|ketamina)\b/i;
  const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg>';

  const mmss = s => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
  const txt = v => typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : '');
  const arr = v => Array.isArray(v) ? v : [];
  /* clave para reconocer el mismo medicamento: el nombre antes de la dosis, sin la forma farmacéutica */
  const FORMAS = /^(tabletas?|tabs?|capsulas?|caps|comprimidos?|grageas?|jarabe|suspension|solucion|gotas|ampolletas?|inyectable|crema|gel|unguento|ovulos?|supositorios?|oral|de|en)$/;
  const rxKey = m => { const t = norm(m).replace(/[^a-z0-9]+/g, ' ').trim().split(' '), i = t.findIndex(x => /^\d/.test(x)); return (i > 0 ? t.slice(0, i) : t).filter(x => !FORMAS.test(x)).join(' ') || t[0] || ''; };
  const edadTxt = p => { const a = p.fnac ? ageLabel(p.fnac) : ''; return !a ? '' : (/m$/.test(a) ? a.replace(' m', ' meses') : a + ' años'); };
  const tallaM = t => { const n = parseFloat(String(t).replace(',', '.')); return !n ? 0 : (n > 3 ? n / 100 : n); };
  const imc = sv => { const p = parseFloat(String(sv.peso || '').replace(',', '.')), t = tallaM(sv.talla); return p && t ? (p / (t * t)).toFixed(1) : ''; };

  /* ---------------- configuración (clave de Gemini: solo en este dispositivo) ---------------- */
  async function cargarCfg() {
    if (cfgOk) return cfg;
    try { Object.assign(cfg, (await Store.get(CFG_KEY)) || {}); } catch (e) { console.error(e); }
    cfgOk = true; return cfg;
  }
  const guardarCfg = () => Store.set(CFG_KEY, { ...cfg }).catch(e => console.error(e));

  async function gem(path, body, ms = 45000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    let res;
    try {
      res = await fetch(`${API}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    } catch (e) {
      const lento = e.name === 'AbortError', err = new Error(lento ? 'Gemini tardó demasiado en responder' : 'Sin conexión con Gemini (revisa el internet)'); err.code = 0; err.red = !lento; throw err;
    } finally { clearTimeout(t); }
    let data = null; try { data = await res.json(); } catch (e) { }
    if (!res.ok) {
      const m = data?.error?.message || '', clave = (res.status === 400 || res.status === 403) && /api key|API_KEY|permission/i.test(m);
      const err = new Error(res.status === 429 ? 'Se alcanzó el límite de uso de Gemini por ahora'
        : res.status === 404 ? 'Ese modelo no existe o no está disponible: elige otro en «Ver modelos»'
        : clave ? 'La clave de Gemini no es válida'
        : `Gemini respondió con error ${res.status}${m ? ': ' + m.slice(0, 160) : ''}`);
      err.code = res.status; err.raw = m; err.clave = clave; throw err;
    }
    return data;
  }
  /* Pide el análisis. Con «respuesta rápida» se le pide al modelo razonar poco (responde en menos tiempo);
     si el modelo elegido no acepta ese ajuste, se repite sin él y ya no se vuelve a intentar. */
  const sinPensar = {};
  async function generar(esTxt, parts) {
    const ruta = `/${encodeURIComponent(cfg.model)}:generateContent`, pensar = cfg.rapido && !sinPensar[cfg.model];
    const cuerpo = p => ({
      systemInstruction: { parts: [{ text: esTxt ? SISTEMA_TXT : SISTEMA }] }, contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, ...(p ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) }
    });
    try { return await gem(ruta, cuerpo(pensar)); }
    catch (e) {
      if (!pensar || e.code !== 400 || !/think/i.test(e.raw || '')) throw e;
      sinPensar[cfg.model] = true; return gem(ruta, cuerpo(false));
    }
  }
  const textoDe = d => {
    const c = d?.candidates?.[0];
    if (!c) throw new Error(d?.promptFeedback?.blockReason ? 'Gemini bloqueó la solicitud (' + d.promptFeedback.blockReason + ')' : 'Gemini no devolvió respuesta');
    return arr(c.content?.parts).map(p => p.text || '').join('');
  };
  function leerJSON(t) {
    t = String(t || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
  }

  /* ---------------- instrucciones para el modelo ---------------- */
  const FORMA = '{"transcripcion":[{"quien":"medico","texto":""}],"historia":{"motivo":"","padecimiento":"","ahf":"","app":"","ago":"","alergias":"","medicamentos":"","estudios":"","exploracion":"","sv":{"ta":"","fc":"","fr":"","temp":"","sat":"","peso":"","talla":"","gluc":""}},"por_confirmar":[],"alarma":"","preguntas":[""],"exploracion_sugerida":[{"nombre":"","como":"","orienta":"","fuente":""}],"diagnosticos":[{"nombre":"","cie10":"","nivel":"alto","a_favor":"","falta":""}],"estudios_sugeridos":[""],"estudios_solicitados":{"laboratorio":false,"imagen":false},"receta":{"dictados":[{"medicamento":"","indicacion":"","controlado":false}],"propuestas":[{"medicamento":"","indicacion":"","motivo":"","controlado":false}],"indicaciones":""},"plan":""}';
  /* Dos variantes de las mismas instrucciones: cuando llega audio (respaldo) y cuando llega el texto ya transcrito en el iPad. */
  const R_AUDIO = ['Recibes fragmentos consecutivos del audio de la consulta',
    'Transcripción: escribe en español solo lo que se oye en el audio nuevo, sin inventar ni completar. Indica quién habla con "medico", "paciente", "acompanante" o "desconocido" (dedúcelo por el contenido). Si el audio es silencio, ruido o no se entiende, devuelve "transcripcion": [] y repite el ESTADO ACTUAL sin cambios.'];
  const R_TEXTO = ['Recibes, en fragmentos consecutivos, el texto de la consulta ya transcrito automáticamente en la tableta',
    'Transcripción: devuelve en "transcripcion" el TEXTO NUEVO completo, repartido según quién habla: "medico", "paciente", "acompanante" o "desconocido" (dedúcelo por el contenido; un mismo renglón puede traer varias voces seguidas). El texto viene de un reconocimiento de voz automático: corrige solo los errores evidentes (un medicamento o un término médico mal escrito, palabras partidas) apoyándote en el contexto, sin agregar, resumir ni quitar contenido. Si una dosis, una cifra o el nombre de un medicamento queda dudoso, no lo adivines: déjalo como llegó y agrega el campo afectado a "por_confirmar". Si el texto nuevo no es conversación real (ruido, palabras sueltas sin sentido), devuelve "transcripcion": [] y repite el ESTADO ACTUAL sin cambios.'];
  const sistema = ([entrada, regla1]) => `Eres un asistente clínico que acompaña en silencio una consulta de medicina general en México. ${entrada} (la médica, el paciente y a veces un acompañante) y mantienes al día la historia clínica, las sugerencias para la médica y la receta. La médica decide siempre: tú solo propones.

Reglas:
1. ${regla1}
2. Historia clínica: parte del ESTADO ACTUAL y agrega lo nuevo. No borres datos previos salvo que se corrijan en la conversación. Redacción médica breve, en tercera persona. Nunca inventes datos: deja "" lo que no se ha mencionado. Si la médica dice en voz alta signos vitales o hallazgos de la exploración, regístralos (peso en kg, talla en metros, temperatura en °C, TA como 120/80). No modifiques los campos listados en "campos_fijos". "ago" solo aplica a mujeres.
3. "por_confirmar": claves de campos de la historia cuyo dato es dudoso (lo dijo el acompañante, se oyó mal o es contradictorio).
4. Sugerencias, siempre breves y accionables: hasta 3 "preguntas" útiles que aún no se han hecho; hasta 2 maniobras en "exploracion_sugerida" con instrucciones concretas de cómo hacerlas y qué orientan; hasta 4 "diagnosticos" probables con "nivel" ("alto", "medio", "bajo" o "descartar"), lo que hay "a_favor" y lo que "falta"; "alarma" solo si hay datos de alarma reales (qué buscar y cuándo referir), si no "". No repitas nada de la lista "hechas".
5. Fundamento: guíate por las Guías de Práctica Clínica mexicanas (CENETEC, IMSS, ISSSTE) y por evidencia actual. En "fuente" escribe el nombre de la guía solo si estás seguro de que existe; si no, escribe "conocimiento general". Nunca inventes claves, citas ni números de guía.
6. Padecimientos prioritarios de este consultorio: ${PRIORITARIOS.join('; ')}.
7. Receta: en "dictados" van únicamente los medicamentos que la médica dijo en voz alta que va a indicar, con la indicación como la dijo (dosis, frecuencia y duración). En "propuestas" puedes sugerir hasta 3 medicamentos de primera línea para el diagnóstico más probable, con dosis según edad y peso, tomando en cuenta alergias, embarazo y medicamentos actuales; si falta información esencial para proponer con seguridad, no propongas. No repitas los que ya están en la receta ni los descartados. Marca "controlado": true en psicotrópicos, estupefacientes y otros que requieren receta especial. "indicaciones": medidas no farmacológicas y datos de alarma que la médica le haya dicho al paciente.
8. "estudios_solicitados": true solo si la médica dijo que solicita laboratorio o imagen. "plan": resumen breve del plan que la médica haya dicho.
9. Responde únicamente con JSON válido, sin texto adicional, exactamente con esta forma: ${FORMA}`;
  const SISTEMA = sistema(R_AUDIO), SISTEMA_TXT = sistema(R_TEXTO);

  /* lote: renglones de texto nuevo ({txt, ini}); sin lote, el fragmento va como audio adjunto */
  function contexto(lote) {
    const p = ses.p, an = [];
    const enRx = ses.rx.filter(r => r.estado === 'aceptado');
    const estado = {
      historia: ses.h, campos_fijos: Object.keys(ses.fijo).filter(k => LBL[k]),
      receta: {
        en_receta: enRx.map(r => ({ medicamento: r.med, indicacion: r.ind })), propuestas_pendientes: ses.rx.filter(r => r.estado === 'propuesto').map(r => r.med),
        descartados: ses.rx.filter(r => r.estado === 'descartado').map(r => r.med), indicaciones: ses.indic
      },
      diagnostico_elegido_por_la_medica: ses.fijo.dx ? ses.dxSel : '', hechas: ses.hechas
    };
    const previas = ses.trans.filter(l => !l.prov).slice(-10);     // las provisionales son justo el texto nuevo: no se repiten
    if (previas.length) an.push('ÚLTIMAS LÍNEAS YA TRANSCRITAS:\n' + previas.map(l => `${l.q}: ${l.t}`).join('\n'));
    if (lote) an.push('TEXTO NUEVO DE LA CONSULTA (transcrito automáticamente, sin indicar quién habla; puede traer errores de reconocimiento, sobre todo en medicamentos, cifras y términos médicos):\n' + lote.map(l => `[${mmss(l.ini)}] ${l.txt}`).join('\n'));
    return `CONSULTORIO: ${AMBITOS[ses.amb].nombre}
PACIENTE: ${sexoTxt(p.sexo) || 'sexo no registrado'}${edadTxt(p) ? ', ' + edadTxt(p) : ''}. Consulta ${ses.primera ? 'de primera vez' : 'subsecuente'}.
MINUTO DE LA CONSULTA: ${mmss(ses.seg)}
ESTADO ACTUAL (JSON): ${JSON.stringify(estado)}
${an.join('\n')}
${lote ? 'Analiza el TEXTO NUEVO y devuelve el JSON actualizado.' : 'Escucha el audio adjunto (el siguiente fragmento de la consulta) y devuelve el JSON actualizado.'}`;
  }

  /* ---------------- audio: micrófono → fragmentos WAV de 16 kHz ---------------- */
  function a16k(chunks, len, rate) {
    const all = new Float32Array(len); let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    const k = rate / 16000, n = Math.floor(len / k), out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * k), b = Math.min(len, Math.max(a + 1, Math.floor((i + 1) * k))); let s = 0;
      for (let j = a; j < b; j++) s += all[j];
      const v = Math.max(-1, Math.min(1, s / (b - a)));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
    }
    return out;
  }
  function wavB64(pcm) {
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
    const u8 = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /* ---------------- transcripción en el iPad: Whisper en un hilo aparte (vivo-whisper.js) ---------------- */
  const TAM = { base: { webgpu: 207, wasm: 77 }, small: { webgpu: 586, wasm: 249 } };      // MB aproximados de descarga
  const WSP = { w: null, est: 'no', dev: '', modelo: '', err: '', bytes: 0, n: 0, esp: new Map(), carga: null, cargando: '', oyentes: new Set() };
  const wspAviso = () => WSP.oyentes.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  function wspWorker() {
    if (WSP.w) return WSP.w;
    const w = new Worker('vivo-whisper.js', { type: 'module' });
    w.onmessage = e => {
      const m = e.data;
      if (m.t === 'prog') { WSP.bytes = m.loaded; return wspAviso(); }
      const p = WSP.esp.get(m.id); if (!p) return;
      WSP.esp.delete(m.id); clearTimeout(p.t);
      m.t === 'error' ? p.no(new Error(m.msg)) : p.si(m);
    };
    w.onerror = e => { e.preventDefault?.(); wspCae('El motor de voz no pudo iniciar' + (e.message ? ': ' + e.message : '')); };
    return WSP.w = w;
  }
  /* el hilo murió o se colgó: se descarta y quien esperaba recibe el error (la consulta sigue con el respaldo por audio) */
  function wspCae(msg) {
    try { WSP.w?.terminate(); } catch (e) { }
    WSP.w = null; WSP.est = 'error'; WSP.err = msg; WSP.carga = null; WSP.modelo = '';
    const esp = [...WSP.esp.values()]; WSP.esp.clear();
    esp.forEach(p => { clearTimeout(p.t); p.no(new Error(msg)); });
    wspAviso();
  }
  function wspPide(m, ms) {
    return new Promise((si, no) => {
      const id = ++WSP.n, t = ms ? setTimeout(() => wspCae('El motor de voz tardó demasiado'), ms) : 0;
      WSP.esp.set(id, { si, no, t });
      try { wspWorker().postMessage({ ...m, id }, m.audio ? [m.audio.buffer] : []); }
      catch (e) { WSP.esp.delete(id); clearTimeout(t); no(e); }
    });
  }
  /* carga (y la primera vez descarga) el modelo de voz; después queda listo en memoria para todas las consultas */
  function wspCargar(modelo = cfg.wmodelo) {
    if (WSP.est === 'listo' && WSP.modelo === modelo) return Promise.resolve();
    if (WSP.carga && WSP.cargando === modelo) return WSP.carga;
    if (typeof Worker === 'undefined') { WSP.est = 'error'; WSP.err = 'Este navegador no permite transcribir en el dispositivo'; wspAviso(); return Promise.reject(new Error(WSP.err)); }
    WSP.est = 'cargando'; WSP.cargando = modelo; WSP.bytes = 0; WSP.err = ''; wspAviso();
    return WSP.carga = wspPide({ t: 'cargar', modelo }).then(m => {
      WSP.est = 'listo'; WSP.modelo = m.modelo; WSP.dev = m.dev; WSP.carga = null;
      cfg.wlisto = { ...cfg.wlisto, [m.modelo]: m.dev }; guardarCfg();
      try { navigator.storage?.persist?.()?.catch?.(() => { }); } catch (e) { }
      previo.t = 0; wspAviso();
    }, e => {
      WSP.carga = null; if (WSP.est !== 'error' || !WSP.err) { WSP.est = 'error'; WSP.err = e.message; }
      if (/fetch|network|load failed/i.test(WSP.err)) WSP.err = 'no se pudo descargar el modelo de voz (revisa el internet)';
      wspAviso(); throw e;
    });
  }
  const wspTr = f32 => wspPide({ t: 'tr', audio: f32 }, 60000);
  /* ¿siguen guardados en el iPad los archivos del modelo? (el sistema puede borrarlos si falta espacio) */
  async function enCache(modelo) {
    try { const ks = await (await caches.open('transformers-cache')).keys(); return ks.some(r => r.url.includes('whisper-' + modelo) && r.url.includes('encoder_model')); }
    catch (e) { return true; }
  }
  const localLista = () => cfg.modo === 'local' && !!cfg.wlisto[cfg.wmodelo];
  /* Antes de una consulta: deja el modelo en memoria solo si sigue guardado en el iPad. Nunca lo descarga a media consulta
     (son cientos de MB); si el sistema lo borró, se marca como «sin preparar» y la consulta usa el respaldo por audio. */
  async function wspAuto() {
    if (!localLista()) return false;
    if (WSP.est === 'listo' && WSP.modelo === cfg.wmodelo) return true;
    if (!(await enCache(cfg.wmodelo))) { const w = { ...cfg.wlisto }; delete w[cfg.wmodelo]; cfg.wlisto = w; guardarCfg(); previo.t = 0; wspAviso(); return false; }
    wspCargar().catch(e => console.error(e)); return true;
  }
  /* Whisper a veces «oye» frases típicas de subtítulos cuando solo hay ruido: se descartan, igual que las repeticiones en bucle */
  const ALUCINA = /subt[ií]tulos? (realizados|creados|hechos|por)|amara\.org|gracias por ver|suscr[ií]b(ete|anse|ite)|dale (a )?like|m[aá]s informaci[oó]n (en )?www\./i;
  function limpia(t) {
    t = String(t || '').replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || ALUCINA.test(t) || !/[a-záéíóúñ0-9]/i.test(t)) return '';
    const out = [];
    (t.match(/[^.!?…]+[.!?…]*/g) || [t]).forEach(x => {
      x = x.trim(); const n = out.length;
      if (x && !(n >= 2 && norm(out[n - 1]) === norm(x) && norm(out[n - 2]) === norm(x))) out.push(x);
    });
    return out.join(' ');
  }

  /* Corte por pausas (solo con transcripción local): junta la voz en fragmentos que terminan en un silencio.
     Lo que no trae voz no se procesa; un fragmento nunca pasa de 28 s (el máximo que Whisper atiende de una vez). */
  const vadNuevo = () => ({ ruido: 0.004, voz: false, hab: 0, sil: 0, esp: 0, rms: [], t0: 0 });
  function oir(s, f) {
    const v = s.vad, fd = f.length / s.rate;
    let q = 0; for (let i = 0; i < f.length; i += 4) q += f[i] * f[i];
    const r = Math.sqrt(q / (f.length / 4));
    v.ruido = r < v.ruido ? v.ruido * 0.7 + r * 0.3 : v.ruido * 0.998 + r * 0.002;        // piso de ruido del cuarto
    const habla = r > Math.min(0.05, Math.max(0.006, v.ruido * 3));
    if (!v.voz && !habla) {
      s.buf.push(f); s.bufLen += f.length;
      while (s.buf.length > 4) s.bufLen -= s.buf.shift().length;                           // guarda ~0.3 s por si empieza una palabra
      if ((v.esp += fd) >= 6) { v.esp = 0; s.stats.sil++; if (!pend(s)) estado('Escuchando (silencio)'); pintaTec(); }
      return;
    }
    if (!v.voz) { Object.assign(v, { voz: true, hab: 0, sil: 0, esp: 0, rms: s.buf.map(() => 0), t0: s.seg }); if (s.est === 'Escuchando (silencio)') estado('Escuchando'); }
    s.buf.push(f); s.bufLen += f.length; v.rms.push(r);
    if (habla) { v.hab += fd; v.sil = 0; } else v.sil += fd;
    const dur = s.bufLen / s.rate, min = s.trCola ? 12 : (WSP.dev === 'webgpu' ? 4 : 8), max = Math.min(28, cfg.seg);
    if ((dur >= min && v.sil >= 0.7) || v.sil >= 2 || dur >= max) cerrarSeg(s, dur >= max && v.sil < 0.3);
  }
  function cerrarSeg(s, forzado) {
    const v = s.vad; if (!v.voz || !s.buf.length) return;
    const fl = s.buf[0].length; let n = s.buf.length;
    if (forzado) {                       // no hubo pausa: corta en el instante más callado de los últimos 3 s para no partir una palabra
      let m = Infinity; const tot = n;
      for (let i = Math.max(1, tot - Math.ceil(3 * s.rate / fl)); i < tot - 1; i++) if (v.rms[i] <= m) { m = v.rms[i]; n = i + 1; }
    } else n = Math.max(1, n - Math.max(0, Math.floor((v.sil - 0.3) * s.rate / fl)));     // quita el silencio del final, menos ~0.3 s
    const partes = s.buf.slice(0, n), resto = forzado ? s.buf.slice(n) : [], ini = v.t0, hab = v.hab;
    let len = 0; partes.forEach(c => len += c.length);
    s.buf = resto; s.bufLen = resto.reduce((a, c) => a + c.length, 0);
    Object.assign(v, resto.length ? { voz: true, hab: s.bufLen / s.rate, sil: 0, rms: v.rms.slice(n), t0: s.seg } : { voz: false, hab: 0, sil: 0, esp: 0, rms: [] });
    if (hab < 0.25) { s.stats.sil++; return pintaTec(); }                                  // un golpe o un ruido corto, no voz
    despachar(s, { pcm: a16k(partes, len, s.rate), ini, t0: performance.now() });
  }
  /* un fragmento de voz: se transcribe aquí y se encola el texto; si Whisper no está o falla, el fragmento se encola como audio */
  function despachar(s, seg) {
    if (WSP.est !== 'listo') { s.cola.push(seg); return bombear(); }
    s.trCola++; if (!s.enviando) estado('Transcribiendo…');
    s.trHilo = s.trHilo.then(async () => {
      if (ses !== s || s.cancel) return;
      const t0 = performance.now();
      try {
        if (WSP.est !== 'listo') throw new Error(WSP.err || 'La transcripción en el iPad no está disponible');
        const f = new Float32Array(seg.pcm.length); for (let i = 0; i < f.length; i++) f[i] = seg.pcm[i] / 32768;
        const m = await wspTr(f);
        if (ses !== s) return;
        s.stats.tr.push((performance.now() - t0) / 1000);
        const t = limpia(m.texto);
        if (!t) s.stats.sil++;
        else { const id = uid(); s.trans.push({ q: 'desconocido', t, s: seg.ini, id, prov: true }); s.cola.push({ txt: t, ini: seg.ini, id, t0: seg.t0 }); pintaTrans(); }
      } catch (e) {
        console.error(e); if (ses !== s) return;
        s.stats.trErr++; s.cola.push(seg);
      } finally {
        if (ses === s) { s.trCola--; if (!s.enviando && !s.trCola) estado(reposo(s)); pintaTec(); bombear(); }
      }
    });
  }
  const pend = s => !!(s.enviando || s.cola.length || s.trCola);
  const reposo = s => s.fin ? (pend(s) ? 'Procesando lo último…' : 'Consulta finalizada') : s.pausado ? 'En pausa' : 'Escuchando';

  async function micStart() {
    const s = ses, AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar el micrófono desde la app.');
    s.micListo = false;
    const ac = new AC(); s.ac = ac;                     // se crea dentro del toque del usuario (requisito de Safari)
    ac.resume?.().catch(() => { });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (ses !== s) { stream.getTracks().forEach(t => t.stop()); ac.close(); return; }
    s.stream = stream; s.rate = ac.sampleRate; s.buf = []; s.bufLen = 0; s.vad = vadNuevo();
    const src = ac.createMediaStreamSource(stream), mute = ac.createGain(); mute.gain.value = 0; mute.connect(ac.destination);
    const onPCM = f => { if (ses !== s || s.pausado || s.fin) return; s.ultPCM = performance.now(); nivel(f); if (s.local) oir(s, f); else { s.buf.push(f); s.bufLen += f.length; } };
    try {
      await ac.audioWorklet.addModule('vivo-worklet.js');
      const node = new AudioWorkletNode(ac, 'vivo-cap');
      node.port.onmessage = e => onPCM(e.data);
      src.connect(node); node.connect(mute);
    } catch (e) {
      const sp = ac.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = ev => onPCM(new Float32Array(ev.inputBuffer.getChannelData(0)));
      src.connect(sp); sp.connect(mute); s.sp = sp;
    }
    if (ac.state === 'suspended') await ac.resume().catch(() => { });
    s.ultPCM = performance.now(); s.micErr = ''; s.micListo = true;
  }
  function micStop() {
    if (!ses) return;
    try { ses.stream?.getTracks().forEach(t => t.stop()); } catch (e) { }
    try { ses.ac?.close(); } catch (e) { }
    ses.stream = null; ses.ac = null; ses.micListo = false;
  }
  const msgMic = e => (e?.name === 'NotAllowedError' ? 'Falta el permiso del micrófono. En el iPad: Ajustes → Safari → Micrófono → Permitir, y vuelve a abrir la app. ' : '') + (e?.message || '');
  /* vuelve a abrir el micrófono desde un toque (después de una llamada, de cambiar de app o de un corte de audio) */
  async function reabrirMic() {
    const s = ses; if (!s || s.fin || s.demo) return;
    try { estado('Abriendo micrófono…'); micStop(); s.micErr = ''; s.pausado = false; await micStart(); if (ses !== s) return; estado('Escuchando'); wake(); }
    catch (e) { console.error(e); if (ses !== s) return; s.micErr = msgMic(e) || 'No se pudo abrir el micrófono.'; s.pausado = true; estado('Sin micrófono'); }
    pintaTop(); saludTic();
  }
  let lvlRaf = 0;
  function nivel(f) {
    let s = 0; for (let i = 0; i < f.length; i += 16) s += f[i] * f[i];
    ses.lvl = Math.sqrt(s / (f.length / 16));
    if (lvlRaf) return;
    lvlRaf = requestAnimationFrame(() => {
      lvlRaf = 0; const el = $('#vvLvl'); if (!el || !ses) return;
      const k = Math.min(1, ses.lvl * 14);
      [...el.children].forEach((b, i) => b.style.height = (4 + k * 18 * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.7 + ses.seg)))) + 'px');
    });
  }
  async function wake() { try { if (ses && !ses.wl && navigator.wakeLock) { ses.wl = await navigator.wakeLock.request('screen'); ses.wl.addEventListener?.('release', () => { if (ses) ses.wl = null; }); } } catch (e) { } }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (ses && !ses.fin) { wake(); ses.ultPCM = performance.now(); if (!ses.pausado) ses.ac?.resume?.().catch(() => { }); }
    else if (!ses) pintarBoton(true);
  });
  window.addEventListener('online', () => { if (ses) { ses.sinRed = false; ses.urge = true; ses.despierta?.(); bombear(); saludTic(); } else pintarBoton(true); });
  window.addEventListener('offline', () => { if (ses) saludTic(); else pintarBoton(true); });

  function tic() {
    if (!ses) return;
    if (ses.fin) return saludTic();
    if (!ses.pausado) { ses.seg++; ses.desde++; }
    const t = $('#vvT'); if (t) t.textContent = mmss(ses.seg);
    if (ses.demo) return;
    if (!ses.pausado && ses.ac?.state === 'suspended') { estado('Toca «Reanudar»'); ses.ac.resume().catch(() => { }); }
    if (!ses.local && !ses.pausado && ses.desde >= cfg.seg) cortar();
    saludTic();
  }
  /* cierra el fragmento en curso: con transcripción local, lo que haya de voz; en modo audio, el bloque de tiempo */
  function cortar() {
    const s = ses;
    if (s.local) return cerrarSeg(s, false);
    const len = s.bufLen, ini = Math.max(0, s.seg - s.desde);
    s.desde = 0;
    if (!len) return;
    const chunks = s.buf; s.buf = []; s.bufLen = 0;
    const pcm = a16k(chunks, len, s.rate);
    let q = 0, n = 0; for (let i = 0; i < pcm.length; i += 8) { q += pcm[i] * pcm[i]; n++; }
    if (Math.sqrt(q / Math.max(1, n)) / 32768 < 0.0025) { s.stats.sil++; if (!s.enviando) estado('Escuchando (silencio)'); pintaTec(); return; }
    s.cola.push({ pcm, ini, t0: performance.now() });
    bombear();
  }
  /* Envía a Gemini lo que haya en la cola, de uno en uno. La cola puede traer renglones de texto (transcritos aquí) o
     fragmentos de audio (respaldo); se envía de una vez toda la racha del mismo tipo. El texto se agrupa para no pasar
     de un análisis cada «cfg.cada» segundos (cuida el límite del plan gratuito) y nunca se descarta si falla el envío. */
  async function bombear() {
    const s = ses;
    if (!s || s.enviando || !s.cola.length || s.cancel) return;
    const esTxt = s.cola[0].txt !== undefined;
    if (esTxt && !s.fin && !s.urge) {
      const falta = cfg.cada * 1000 - (performance.now() - s.ultEnv);
      if (falta > 0) { if (!s.tEnv) s.tEnv = setTimeout(() => { s.tEnv = 0; if (ses === s) bombear(); }, falta); return; }
    }
    s.urge = false; s.enviando = true; s.ultEnv = performance.now();
    let k = 0; while (k < s.cola.length && (s.cola[k].txt !== undefined) === esTxt) k++;
    const lote = s.cola.splice(0, k), ini = lote[0].ini, t0 = performance.now();
    let n = 0, pcm = null, parts;
    if (esTxt) parts = [{ text: contexto(lote) }];
    else {
      lote.forEach(l => n += l.pcm.length);
      pcm = new Int16Array(n); let o = 0; lote.forEach(l => { pcm.set(l.pcm, o); o += l.pcm.length; });
      parts = [{ text: contexto() }, { inlineData: { mimeType: 'audio/wav', data: wavB64(pcm) } }];
    }
    estado('Analizando…');
    try {
      const d = await generar(esTxt, parts);
      if (ses !== s) return;
      const r = leerJSON(textoDe(d));
      s.stats.n++; s.stats.lat.push((performance.now() - t0) / 1000); s.espera = 0; s.stats.ultErr = '';
      s.errSeg = 0; s.errCod = 0; s.errClave = false; s.sinRed = false;
      esTxt ? s.stats.txt++ : s.stats.aud++;
      aplicar(r, ini, esTxt ? lote : null);
      estado(s.trCola ? 'Transcribiendo…' : reposo(s));
    } catch (e) {
      console.error(e);
      if (ses !== s) return;
      s.stats.err++; s.stats.ultErr = e.message; s.errSeg = (s.errSeg || 0) + 1; s.errCod = e.code; s.errClave = !!e.clave; s.sinRed = !!e.red;
      if (esTxt) s.cola.unshift(...lote);
      else if (n / 16000 <= 150) s.cola.unshift({ pcm, ini, t0: lote[0].t0 }); else s.stats.perdido = (s.stats.perdido || 0) + Math.round(n / 16000);
      estado(e.code === 429 ? 'Límite de Gemini: reintentando' : e.red ? 'Sin internet: reintentando' : 'Sin respuesta: reintentando');
      pintaTec(); saludTic();
      s.espera = Math.min(60, (s.espera || 4) * 2);
      await new Promise(r => { s.despierta = r; setTimeout(r, s.espera * 1000); });
      s.urge = true;
    } finally {
      if (ses === s) { s.enviando = false; pintaTec(); if (s.cola.length && !s.cancel) bombear(); else if (!s.trCola) estado(reposo(s)); }
    }
  }

  /* ---------------- respuesta del modelo → estado de la consulta ---------------- */
  function rxPoner(med, ind, origen, extra = {}) {
    const k = rxKey(med); if (!k) return;
    const ctrl = !!extra.controlado || CONTROLADOS.test(med);
    const it = ses.rx.find(r => r.k === k);
    if (!it) { ses.rx.push({ id: uid(), k, med, ind, origen, estado: origen === 'asistente' ? 'propuesto' : 'aceptado', ctrl, motivo: extra.motivo || '', t: extra.t }); ses.nuevo.rx = 1; return; }
    if (it.estado === 'descartado' || it.fijo) return;
    if (origen === 'dictado') {
      if (it.estado !== 'aceptado' || (ind && it.ind !== ind)) ses.nuevo.rx = 1;
      Object.assign(it, { med, ind: ind || it.ind, origen: 'dictado', estado: 'aceptado', ctrl: it.ctrl || ctrl, t: it.t ?? extra.t });
    } else if (it.estado === 'propuesto') Object.assign(it, { med, ind: ind || it.ind, motivo: extra.motivo || it.motivo, ctrl: it.ctrl || ctrl });
  }
  /* lote: los renglones de texto que se enviaron (transcritos en el iPad). Sus líneas provisionales se cambian por las que
     devuelve el modelo, ya con quién habla; si el modelo las recorta o no las devuelve, se conservan tal como se oyeron. */
  function aplicar(r, ini, lote) {
    if (!ses || !r || typeof r !== 'object') return;
    let lineas = arr(r.transcripcion).map(l => ({ q: QUIEN[l?.quien] ? l.quien : 'desconocido', t: txt(l?.texto), s: ini })).filter(l => l.t);
    if (lote) {
      const ids = new Set(lote.map(l => l.id)), prov = ses.trans.filter(l => ids.has(l.id)), i0 = ses.trans.findIndex(l => ids.has(l.id));
      const largo = a => a.reduce((n, l) => n + l.t.length, 0), vacio = !lineas.length;
      if (vacio || largo(lineas) < largo(prov) * 0.6) lineas = prov.map(l => ({ q: 'desconocido', t: l.t, s: l.s }));
      ses.trans = ses.trans.filter(l => !ids.has(l.id));
      ses.trans.splice(i0 < 0 ? ses.trans.length : i0, 0, ...lineas);
      if (vacio) { pintaTrans(); pintaTec(); return; }       // el modelo no vio conversación real: no se toca la historia
    } else {
      if (!lineas.length) { pintaTec(); return; }            // silencio o ruido: no se toca nada
      ses.trans.push(...lineas);
    }
    ses.nuevo = {};
    const h = r.historia || {};
    CAMPOS.forEach(([k]) => { const v = txt(h[k]); if (v && !ses.fijo[k] && v !== ses.h[k]) { ses.h[k] = v; ses.nuevo[k] = 1; } });
    SV.forEach(([k]) => { const v = txt(h.sv?.[k]); if (v && !ses.fijo['sv.' + k] && v !== ses.h.sv[k]) { ses.h.sv[k] = v; ses.nuevo.sv = 1; } });
    if (Array.isArray(r.por_confirmar)) ses.dudas = arr(r.por_confirmar).map(txt).filter(k => LBL[k] && !ses.fijo[k]);
    if (typeof r.alarma === 'string') ses.alarma = txt(r.alarma);
    const hecha = t => ses.hechas.includes(norm(t));
    if (Array.isArray(r.preguntas)) ses.preguntas = arr(r.preguntas).map(txt).filter(t => t && !hecha(t)).slice(0, 3);
    if (Array.isArray(r.exploracion_sugerida)) ses.explora = arr(r.exploracion_sugerida).map(e => ({ nombre: txt(e?.nombre), como: txt(e?.como), orienta: txt(e?.orienta), fuente: txt(e?.fuente) })).filter(e => e.nombre && !hecha(e.nombre)).slice(0, 2);
    if (Array.isArray(r.diagnosticos)) ses.dx = arr(r.diagnosticos).map(d => ({ nombre: txt(d?.nombre), cie10: txt(d?.cie10), nivel: d?.nivel in NIVEL ? d.nivel : 'medio', favor: txt(d?.a_favor), falta: txt(d?.falta) })).filter(d => d.nombre).slice(0, 4);
    if (!ses.fijo.dx) ses.dxSel = (ses.dx.find(d => d.nivel === 'alto') || ses.dx.find(d => d.nivel === 'medio') || {}).nombre || ses.dxSel;
    if (Array.isArray(r.estudios_sugeridos)) ses.estudiosSug = arr(r.estudios_sugeridos).map(txt).filter(Boolean).slice(0, 5);
    if (r.estudios_solicitados?.laboratorio) ses.lab = true;
    if (r.estudios_solicitados?.imagen) ses.img = true;
    if (txt(r.plan) && !ses.fijo.plan) ses.plan = txt(r.plan);
    const rc = r.receta || {};
    arr(rc.dictados).forEach(m => txt(m?.medicamento) && rxPoner(txt(m.medicamento), txt(m.indicacion), 'dictado', { controlado: m.controlado, t: ini }));
    const vivas = new Set();
    arr(rc.propuestas).slice(0, 3).forEach(m => { const med = txt(m?.medicamento); if (!med) return; vivas.add(rxKey(med)); rxPoner(med, txt(m.indicacion), 'asistente', { controlado: m.controlado, motivo: txt(m.motivo) }); });
    if (Array.isArray(rc.propuestas)) ses.rx = ses.rx.filter(x => !(x.estado === 'propuesto' && x.origen === 'asistente' && !vivas.has(x.k)));
    if (txt(rc.indicaciones) && !ses.fijo.indic && txt(rc.indicaciones) !== ses.indic) { ses.indic = txt(rc.indicaciones); ses.nuevo.indic = 1; }
    pinta();
  }

  /* ---------------- flujo de inicio: consultorio → paciente → consentimiento ---------------- */
  async function iniciar() {
    if (ses) return;
    await cargarCfg();
    await wspAuto();                                                 // deja el modelo de voz cargando mientras se elige al paciente
    chequeoPrevio().catch(() => { });
    const sh = openSheet(`<div class="shead"><h2>¿Dónde es esta consulta?</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      <p class="hint" style="margin-bottom:14px">Los pacientes y las notas de cada consultorio se guardan por separado y nunca se mezclan.</p>
      <div class="vv-pick">${Object.entries(AMBITOS).map(([k, a]) => `<button class="vv-big" data-amb="${k}"><b>${esc(a.nombre)}</b><span>${k === AMB ? 'Es el que está abierto ahora' : 'Cambiar a este consultorio'}</span></button>`).join('')}</div>`, { small: true });
    $('[data-close]', sh).onclick = closeSheet;
    $$('[data-amb]', sh).forEach(b => b.onclick = async () => { closeSheet(); await cambiarAmbito(b.dataset.amb); go('#/hoy'); render(); elegirPaciente(); });
  }
  function elegirPaciente() {
    const sh = openSheet(`<div class="shead"><h2>¿Quién es el paciente?</h2><span class="tag o">${esc(AMBITOS[AMB].corto)}</span><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      <div class="searchbox">${IC.search}<input id="vq" type="search" placeholder="Número de expediente o nombre" autocomplete="off" autocapitalize="characters"></div>
      <div class="results" id="vres"></div>
      <p class="hint" style="margin-top:10px">Escribe al menos 2 letras o números. Si no existe, puedes registrarlo ahí mismo.</p>`);
    $('[data-close]', sh).onclick = closeSheet;
    const q = $('#vq', sh), res = $('#vres', sh);
    q.addEventListener('input', () => {
      const n = norm(q.value); if (n.length < 2) { res.innerHTML = ''; return; }
      const looksExp = /\d/.test(q.value);
      res.innerHTML = S.patients.filter(p => norm(p.nombre).includes(n) || norm(p.expediente).includes(n)).slice(0, 8).map(resRow).join('') +
        `<button class="res" data-new style="border-style:dashed"><span class="avatar" style="background:rgba(99,91,255,.12);color:var(--violeta)">${IC.plus}</span><span class="who"><b>Registrar paciente nuevo</b><span>${looksExp ? 'Expediente' : 'Nombre'}: ${esc(q.value.trim())}</span></span></button>`;
      $$('[data-pid]', res).forEach(b => b.onclick = () => { closeSheet(); consentir(pat(b.dataset.pid)); });
      $('[data-new]', res).onclick = () => { closeSheet(); openPacienteForm({ prefill: looksExp ? { expediente: q.value.trim() } : { nombre: q.value.trim() }, onSaved: id => consentir(pat(id)) }); };
    });
    setTimeout(() => q.focus(), 60);
  }
  const chk = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7"/></svg>';
  function consentir(p) {
    if (!p) return;
    const c = { pac: false, acomp: false, solo: false }, sinClave = !cfg.apiKey;
    const sh = openSheet(`<div class="shead"><h2>Avísales que la tableta va a escuchar</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      <p class="hint" style="margin-bottom:12px">${esc(p.nombre)} · ${esc(AMBITOS[AMB].nombre)}</p>
      <ol class="vv-pts"><li>La tableta escucha la consulta para ayudar a llenar la historia clínica.</li><li>El audio no se guarda. Solo queda la nota escrita, que revisa la doctora.</li><li>Pueden pedir que se pause o se apague en cualquier momento.</li></ol>
      <div class="vv-checks">
        <button class="vv-check" data-c="pac" aria-pressed="false"><i>${chk}</i>${p.sexo === 'F' ? 'La paciente' : 'El paciente'} está de acuerdo</button>
        <button class="vv-check" data-c="acomp" aria-pressed="false"><i>${chk}</i>Su acompañante está de acuerdo</button>
        <button class="vv-check" data-c="solo" aria-pressed="false"><i>${chk}</i>Viene sin acompañante</button>
      </div>
      <div id="vvPre" class="vv-prebox"></div>
      ${sinClave ? '<p class="hint" style="margin-top:12px;color:#8A5A00">Todavía no hay clave de Gemini en este iPad (Ajustes → Consulta en vivo). Sin clave no se puede escuchar; puedes ver una demostración con una consulta ficticia.</p>' : ''}
      <div class="sticky-actions"><button class="btn ghost" data-manual style="margin-right:auto">Consulta sin escucha</button>
        ${sinClave ? '<button class="btn soft" data-demo>Ver demostración</button>' : ''}
        <button class="btn primary" data-go disabled>${MIC} Empezar a escuchar</button></div>`, { small: true });
    const upd = () => { $$('[data-c]', sh).forEach(b => { b.classList.toggle('on', c[b.dataset.c]); b.setAttribute('aria-pressed', c[b.dataset.c]); }); $('[data-go]', sh).disabled = sinClave || !(c.pac && (c.acomp || c.solo)); };
    $$('[data-c]', sh).forEach(b => b.onclick = () => { const k = b.dataset.c; c[k] = !c[k]; if (k === 'acomp' && c.acomp) c.solo = false; if (k === 'solo' && c.solo) c.acomp = false; upd(); });
    $('[data-close]', sh).onclick = closeSheet;
    $('[data-manual]', sh).onclick = () => { closeSheet(); openConsulta({ patientId: p.id }); };
    $('[data-demo]', sh) && ($('[data-demo]', sh).onclick = () => { closeSheet(); demo(); });
    $('[data-go]', sh).onclick = () => { closeSheet(); abrir(p, false, { hora: nowTime(), acomp: c.acomp }); };
    /* resumen de «¿está todo listo?»; se actualiza solo mientras termina de cargar el modelo de voz */
    const pre = async () => {
      const caja = $('#vvPre', sh); if (!caja || !caja.isConnected) return WSP.oyentes.delete(pre);
      const h = await chequeoPrevio().catch(() => null); if (!h || !caja.isConnected) return;
      const it = h.items.map(i => i.k === 'voz' && i.n === 'ok' && cfg.modo === 'local' && WSP.est === 'cargando' ? { ...i, n: 'info', t: 'Cargando la transcripción en el iPad…', d: 'Puedes empezar ya: mientras termina, se envía el audio.' } : i);
      caja.innerHTML = `<div class="vv-prehead ${h.n}">${h.n === 'ok' ? IC_OK : IC_AV}<b>${h.n === 'ok' ? 'Todo listo para escuchar' : h.n === 'aviso' ? 'Lista, con un aviso' : 'Falta algo para poder escuchar'}</b></div>${h.n === 'ok' && !it.some(i => i.n === 'info') ? '' : saludHTML(it.filter(i => i.n !== 'ok'))}`;
    };
    WSP.oyentes.add(pre); pre();
  }

  /* ---------------- sesión ---------------- */
  function nueva(p, esDemo, consent) {
    const an = p.antecedentes || {}, cr = cronActivo(p) ? p.cronico : null;
    const junta = (...xs) => xs.filter(Boolean).join('. ');
    return {
      p, amb: AMB, demo: esDemo, consent, primera: esDemo || !consultasDe(p.id).length, seg: 0, desde: 0, pausado: false, fin: false, tab: 'historia',
      trans: [], nuevo: {}, fijo: {}, dudas: [], hechas: [],
      h: {
        motivo: '', padecimiento: '', ahf: an.ahf || '', app: junta(cr && cr.enfermedades.map(e => e.nombre).join(', '), an.patologicos, an.quirurgicos && 'Quirúrgicos: ' + an.quirurgicos),
        ago: an.gineco || '', alergias: an.alergicos || '', medicamentos: junta(cr && cr.medicamentos.join(', '), an.tratamiento), estudios: '', exploracion: '', sv: {}
      },
      alarma: '', preguntas: [], explora: [], dx: [], dxSel: '', estudiosSug: [], plan: '', lab: false, img: false, rx: [], indic: '',
      cola: [], enviando: false, buf: [], bufLen: 0, lvl: 0, stats: { n: 0, err: 0, sil: 0, lat: [], ultErr: '', tr: [], trErr: 0, txt: 0, aud: 0 },
      /* local: esta consulta corta por pausas y transcribe en el iPad (si el modelo de voz ya está preparado) */
      local: !esDemo && localLista(), vad: vadNuevo(), trCola: 0, trHilo: Promise.resolve(), ultEnv: -1e9, tEnv: 0, urge: false,
      ultPCM: performance.now(), micErr: '', micListo: false, errSeg: 0, errCod: 0, errClave: false, sinRed: false, salud: null, saludF: '', fallaSeg: 0
    };
  }
  async function abrir(p, esDemo, consent) {
    ses = nueva(p, esDemo, consent);
    const s = ses;
    montar();
    s.timer = setInterval(tic, 1000);
    if (esDemo) { estado('Demostración'); return correrDemo(); }
    estado('Abriendo micrófono…');
    if (s.local) wspAuto();                                           // normalmente ya está en memoria; si no está disponible, la consulta sigue con audio
    try { await micStart(); if (ses !== s) return; estado('Escuchando'); wake(); }
    catch (e) {
      console.error(e); if (ses !== s) return;
      s.pausado = true; s.micErr = msgMic(e) || 'No se pudo abrir el micrófono.'; estado('Sin micrófono'); pintaTop();
      avisoBox('No se pudo usar el micrófono', msgMic(e));
    }
    saludTic();
  }
  function cerrar() {
    if (!ses) return;
    const s = ses; s.cancel = true; s.despierta?.(); clearTimeout(s.tEnv);
    clearInterval(s.timer); micStop(); try { s.wl?.release(); } catch (e) { }
    (s.demoT || []).forEach(clearTimeout);
    ses = null; $('#vivo').innerHTML = ''; document.body.classList.remove('vv-abierto');
    pintarBoton(true);
  }
  async function pausa() {
    const s = ses; if (!s || s.fin || s.demo) return;
    const pista = s.stream?.getAudioTracks?.()[0];
    if (!s.ac || s.micErr || !pista || pista.readyState === 'ended') return reabrirMic();      // sin micrófono vivo: se abre de nuevo
    if (s.pausado || s.ac.state !== 'running') { s.pausado = false; await s.ac.resume().catch(() => { }); s.ultPCM = performance.now(); estado('Escuchando'); wake(); }
    else { cortar(); s.pausado = true; await s.ac.suspend().catch(() => { }); estado('En pausa'); s.urge = true; bombear(); }
    pintaTop(); saludTic();
  }
  async function finalizar() {
    const s = ses; if (!s || s.fin) return;
    if (!s.demo) { cortar(); micStop(); }
    (s.demoT || []).forEach(clearTimeout);
    s.fin = true; s.pausado = true; try { s.wl?.release(); } catch (e) { }
    pintaTop(); pintaCierre();
    if (s.demo) return estado('Demostración terminada');
    estado(reposo(s));
    s.urge = true; s.despierta?.(); bombear(); saludTic();
  }
  async function volver() {
    const s = ses; if (!s || !s.fin) return;
    s.fin = false; s.pausado = false; pinta(); pintaTop();
    if (s.demo) return estado('Demostración');
    try { estado('Abriendo micrófono…'); await micStart(); estado('Escuchando'); wake(); }
    catch (e) { s.pausado = true; s.micErr = msgMic(e) || 'No se pudo abrir el micrófono.'; estado('Sin micrófono'); pintaTop(); }
    saludTic();
  }

  /* ---------------- pantalla ---------------- */
  const estado = t => { if (ses) ses.est = t; const e = $('#vvEstado'); if (e) e.textContent = t; const r = $('#vvRec'); if (r) r.dataset.e = ses?.fin ? 'fin' : ses?.pausado ? 'pausa' : 'rec'; };
  function montar() {
    const p = ses.p;
    document.body.classList.add('vv-abierto');
    $('#vivo').innerHTML = `<div class="vv" data-amb="${ses.amb}">
      <header class="vv-top">
        <div class="vv-pac"><span class="vv-av">${esc(initials(p.nombre))}</span>
          <div class="vv-who"><b>${esc(p.nombre)}</b><span>${[edadTxt(p), sexoTxt(p.sexo)].filter(Boolean).map(esc).join(' · ')}</span><small>${ses.primera ? 'Primera vez' : 'Subsecuente'}${p.expediente ? ' · Exp. ' + esc(p.expediente) : ''}${ses.demo ? ' · Demostración con datos ficticios' : ''}</small></div>
          <span class="vv-amb">${esc(AMBITOS[ses.amb].corto)}</span></div>
        <div class="vv-recw"><div class="vv-rec" id="vvRec" data-e="rec"><i class="dot"></i><span id="vvEstado"></span><span class="vv-lvl" id="vvLvl" aria-hidden="true">${'<i></i>'.repeat(9)}</span><span class="vv-t" id="vvT">00:00</span></div>
          ${ses.demo ? '' : '<button class="vv-salud" id="vvSalud" data-act="salud" data-n="ok" aria-live="polite"></button>'}</div>
        <div class="vv-acts" id="vvActs"></div>
      </header>
      <div id="vvFallo"></div>
      <div id="vvAlarma"></div>
      <div class="vv-body" id="vvBody"></div>
    </div>`;
    $('#vivo').onclick = clic;
    pintaTop(); pinta(); pintaSalud();
  }

  /* ---------------- semáforo: ¿está funcionando todo lo que la consulta en vivo necesita? ---------------- */
  const IC_OK = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="7.2"/><path d="M5.8 9.3l2.2 2.2 4.2-4.6"/></svg>';
  const IC_AV = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5 16.5 15h-15L9 2.5Z"/><path d="M9 7.5v3.5M9 13.2v.1"/></svg>';
  const PESO = { ok: 0, info: 0, aviso: 1, falla: 2 };
  const resumen = it => { const peor = it.reduce((a, b) => PESO[b.n] > PESO[a.n] ? b : a, { n: 'ok' }); return { n: peor.n === 'info' ? 'ok' : peor.n, t: peor.t || 'Todo en orden', d: peor.d || '', k: peor.k || '', items: it }; };
  /* estado de cada pieza durante la consulta: micrófono, transcripción, internet, Gemini y pantalla */
  function salud() {
    const s = ses, it = [], ahora = performance.now(), pon = (k, n, t, d = '') => it.push({ k, n, t, d });
    const enIpad = s.local && WSP.est === 'listo';
    if (!s.fin) {
      const pista = s.stream?.getAudioTracks?.()[0];
      if (s.micErr) pon('mic', 'falla', 'Sin micrófono', s.micErr + ' Toca «Reanudar» para intentarlo de nuevo.');
      else if (s.pausado) pon('mic', 'ok', 'Micrófono en pausa', 'No se escucha nada hasta que toques «Reanudar».');
      else if (!s.micListo) pon('mic', 'ok', 'Abriendo el micrófono…');
      else if (s.ac?.state !== 'running' || !pista || pista.readyState === 'ended' || pista.muted || ahora - s.ultPCM > 3000) pon('mic', 'falla', 'El micrófono se detuvo', 'La tableta no está escuchando. Toca «Reanudar».');
      else pon('mic', 'ok', 'Micrófono escuchando');
    }
    if (enIpad) pon('voz', 'ok', 'Transcripción en el iPad', WSP.dev === 'webgpu' ? 'Con aceleración por GPU.' : 'Sin GPU: funciona, pero más lenta.');
    else if (s.local || cfg.modo === 'local') pon('voz', 'aviso', WSP.est === 'cargando' ? 'Preparando la transcripción en el iPad' : cfg.wlisto[cfg.wmodelo] ? 'Transcripción en el iPad no disponible' : 'Transcripción en el iPad sin preparar',
      'Mientras tanto se envía el audio a Gemini: funciona, pero responde más lento.' + (WSP.est === 'error' && WSP.err ? ' (' + WSP.err + ')' : !cfg.wlisto[cfg.wmodelo] ? ' Prepárala en Ajustes → Consulta en vivo.' : ''));
    else pon('voz', 'ok', 'Transcripción por Gemini', 'Se envía el audio (así está elegido en Ajustes).');
    const viejo = s.cola.length ? (ahora - (s.cola[0].t0 || ahora)) / 1000 : 0;
    if (!navigator.onLine || s.sinRed) pon('red', 'falla', 'Sin internet', enIpad ? 'Se sigue escuchando y transcribiendo en el iPad: no se pierde nada. La historia y las sugerencias se ponen al día solas cuando vuelva la conexión.' : 'El audio se conserva hasta 2.5 minutos mientras vuelve la conexión; después se pierde lo más antiguo.');
    else {
      pon('red', 'ok', 'Internet conectado');
      if (s.errSeg && s.errCod === 429) pon('gem', 'falla', 'Límite de uso de Gemini', 'Se reintenta solo. ' + (enIpad ? 'La conversación se sigue transcribiendo y no se pierde.' : 'El audio se conserva hasta 2.5 minutos.'));
      else if (s.errSeg && s.errClave) pon('gem', 'falla', 'La clave de Gemini no es válida', 'Revísala en Ajustes → Consulta en vivo.');
      else if (s.errSeg >= 2) pon('gem', 'falla', 'Gemini no responde', s.stats.ultErr + '. Se reintenta solo.');
      else if (s.errSeg === 1) pon('gem', 'aviso', 'Reintentando el análisis', s.stats.ultErr + '.');
      else if (viejo > 75) pon('gem', 'aviso', 'El análisis va atrasado', 'Hay conversación de hace más de un minuto sin analizar.');
      else pon('gem', 'ok', s.stats.n ? 'Gemini respondiendo' : 'Gemini listo', s.stats.lat.length ? `Última respuesta en ${s.stats.lat[s.stats.lat.length - 1].toFixed(1)} s.` : '');
    }
    if (!s.fin && !s.pausado) pon('pan', s.wl ? 'ok' : 'info', s.wl ? 'Pantalla activa' : 'La pantalla podría bloquearse sola', s.wl ? 'El iPad no se bloqueará durante la consulta.' : 'Si el iPad se bloquea, deja de escuchar. Tócalo de vez en cuando.');
    return resumen(it);
  }
  function pitido() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext, propio = ses?.ac?.state === 'running', ac = propio ? ses.ac : new AC(), t = ac.currentTime + 0.02;
      [0, 0.24].forEach(d => {
        const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.17);
        o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + 0.19);
      });
      if (!propio) setTimeout(() => ac.close().catch(() => { }), 900);
    } catch (e) { }
  }
  /* se revisa cada segundo; si algo falla más de 5 s seguidos suena un aviso (si está activado) */
  function saludTic() {
    const s = ses; if (!s || s.demo) return;
    const h = salud(), firma = h.n + '|' + h.items.map(i => i.n + i.t).join('|');
    if (h.n === 'falla') { if (++s.fallaSeg === 6 && cfg.beep && !s.fin) pitido(); }
    else { if (s.fallaSeg >= 6) toast('Todo en orden otra vez'); s.fallaSeg = 0; }
    s.salud = h;
    if (firma !== s.saludF) { s.saludF = firma; pintaSalud(); }
  }
  function pintaSalud() {
    const b = $('#vvSalud'), f = $('#vvFallo'); if (!ses || !b || !f) return;
    const h = ses.salud || salud();
    b.dataset.n = h.n; b.innerHTML = (h.n === 'ok' ? IC_OK : IC_AV) + `<span>${esc(h.n === 'ok' ? 'Todo en orden' : h.t)}</span>`;
    b.setAttribute('aria-label', (h.n === 'ok' ? 'Todo en orden' : h.t) + '. Toca para ver el detalle');
    f.innerHTML = h.n === 'ok' ? '' : `<div class="vv-fallo ${h.n}" role="${h.n === 'falla' ? 'alert' : 'status'}">${IC_AV}<div><b>${esc(h.t)}</b><span>${esc(h.d)}</span></div>${h.k === 'mic' ? '<button class="vv-btn sm" data-act="micOk">Reanudar</button>' : '<button class="vv-btn sm" data-act="salud">Ver detalle</button>'}</div>`;
  }
  function saludHTML(items) {
    return `<ul class="vv-sal">${items.map(i => `<li class="${i.n}"><i></i><span><b>${esc(i.t)}</b>${i.d ? `<small>${esc(i.d)}</small>` : ''}</span></li>`).join('')}</ul>`;
  }
  function verSalud() {
    const h = ses.salud || salud();
    const sh = openSheet(`<div class="shead"><h2>${h.n === 'ok' ? 'Todo en orden' : h.n === 'aviso' ? 'Funciona, con un aviso' : 'Algo necesita atención'}</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      ${saludHTML(h.items)}
      <p class="hint" style="margin-top:12px">Este indicador se revisa cada segundo durante la consulta. Verde: todo funciona. Ámbar: funciona con una limitación. Rojo: una parte dejó de funcionar${cfg.beep ? ' (además suena un aviso)' : ''}.</p>
      <div class="sticky-actions"><button class="btn primary" data-close>Entendido</button></div>`, { small: true });
    $$('[data-close]', sh).forEach(x => x.onclick = closeSheet);
  }

  /* ---------------- antes de empezar: ¿está todo listo? (botón de «Hoy» y hoja de consentimiento) ---------------- */
  const previo = { t: 0, r: null, p: null };
  async function chequeoPrevio(forzar) {
    await cargarCfg();
    if (!forzar && previo.r && Date.now() - previo.t < 120000) return previo.r;
    if (previo.p) return previo.p;
    return previo.p = (async () => {
      const it = [], pon = (k, n, t, d = '') => it.push({ k, n, t, d });
      if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) pon('mic', 'falla', 'Micrófono no disponible', 'Este navegador no permite usar el micrófono desde la app.');
      else {
        let est = ''; try { est = (await navigator.permissions?.query({ name: 'microphone' }))?.state || ''; } catch (e) { }
        if (est === 'denied') pon('mic', 'falla', 'Micrófono sin permiso', 'En el iPad: Ajustes → Safari → Micrófono → Permitir, y vuelve a abrir la app.');
        else pon('mic', 'ok', 'Micrófono listo', est === 'prompt' ? 'Pedirá permiso al empezar.' : '');
      }
      if (cfg.modo !== 'local') pon('voz', 'ok', 'Transcripción por Gemini', 'Se envía el audio (así está elegido en Ajustes).');
      else if (WSP.est === 'error') pon('voz', 'aviso', 'Transcripción en el iPad con falla', 'Se enviará el audio a Gemini (más lento). ' + WSP.err);
      else if (cfg.wlisto[cfg.wmodelo] && (WSP.est === 'listo' || await enCache(cfg.wmodelo))) pon('voz', 'ok', 'Transcripción en el iPad lista', cfg.wlisto[cfg.wmodelo] === 'webgpu' ? 'Con aceleración por GPU.' : 'Sin GPU: funciona, pero más lenta.');
      else pon('voz', 'aviso', 'Transcripción en el iPad sin preparar', 'Se enviará el audio a Gemini (más lento). Prepárala en Ajustes → Consulta en vivo.');
      if (!cfg.apiKey) pon('gem', 'falla', 'Falta la clave de Gemini', 'Pégala en Ajustes → Consulta en vivo. Sin clave solo se puede ver la demostración.');
      else if (!navigator.onLine) pon('red', 'falla', 'Sin internet', 'El asistente necesita conexión para analizar la consulta.');
      else try { await gem('?pageSize=1', null, 8000); pon('red', 'ok', 'Internet conectado'); pon('gem', 'ok', 'Gemini responde'); }
        catch (e) {
          if (e.red || e.code === 0) pon('red', 'falla', 'Sin conexión con Gemini', 'Revisa el internet de la tableta.');
          else { pon('red', 'ok', 'Internet conectado'); pon('gem', e.clave ? 'falla' : 'aviso', e.clave ? 'La clave de Gemini no es válida' : 'Gemini respondió con un aviso', e.message + '.'); }
        }
      previo.r = resumen(it); previo.t = Date.now();
      return previo.r;
    })().finally(() => { previo.p = null; });
  }
  /* pinta el indicador del botón «Iniciar consulta en vivo»: verde listo, ámbar con limitación, rojo no disponible */
  async function pintarBoton(forzar) {
    const pon = (n, t, d) => { const b = $('#vivoGo'), e = $('#vivoPre'); if (!b || !e) return; b.dataset.n = n; e.innerHTML = (n === 'ok' ? IC_OK : n === 'espera' ? '<i class="gira"></i>' : IC_AV) + `<span>${esc(t)}</span>`; e.title = d || ''; };
    if (!$('#vivoPre') || ses) return;
    if (!previo.r || forzar) pon('espera', 'Comprobando…');
    try { const h = await chequeoPrevio(forzar); pon(h.n, h.n === 'ok' ? 'Todo listo' : h.t, h.items.filter(i => i.n !== 'ok').map(i => i.t + (i.d ? ': ' + i.d : '')).join(' · ')); }
    catch (e) { console.error(e); pon('aviso', 'No se pudo comprobar'); }
  }
  setInterval(() => { if (!ses && !document.hidden && $('#vivoPre')) pintarBoton(Date.now() - previo.t > 120000); }, 30000);
  WSP.oyentes.add(() => { if (ses) saludTic(); });
  function pintaTop() {
    const a = $('#vvActs'); if (!a || !ses) return;
    a.innerHTML = ses.fin
      ? `<button class="vv-btn" data-act="volver">Volver a la consulta</button><button class="vv-btn" data-act="descartar">Descartar</button><button class="vv-btn pri" data-act="guardar">${ses.demo ? 'Cerrar demostración' : 'Guardar consulta'}</button>`
      : `${ses.demo ? '' : `<button class="vv-btn" data-act="pausa">${ses.pausado ? 'Reanudar' : 'Pausar'}</button>`}<button class="vv-btn pri" data-act="fin">Finalizar consulta</button>`;
    const r = $('#vvRec'); if (r) r.dataset.e = ses.fin ? 'fin' : ses.pausado ? 'pausa' : 'rec';
  }
  const st = k => ses.dudas.includes(k) ? 'duda' : (ses.h[k] ? 'ok' : 'falta');
  const campo = (k, extra = '') => `<button class="vv-campo ${st(k)} ${ses.nuevo[k] ? 'nuevo' : ''} ${extra}" data-act="campo" data-k="${k}"><span class="l"><i></i>${LBL[k]}</span><span class="v">${esc(ses.h[k] || (k === 'exploracion' ? 'Di los hallazgos en voz alta mientras exploras, o toca aquí para escribirlos.' : 'Aún no se ha mencionado'))}</span></button>`;
  const svHTML = () => { const sv = ses.h.sv, i = imc(sv); return `<button class="vv-card vv-sv ${ses.nuevo.sv ? 'nuevo' : ''}" data-act="sv"><span class="l"><i class="${SV.some(([k]) => sv[k]) ? 'ok' : ''}"></i>Signos vitales<em>Dictados en voz alta o a mano</em></span>
      <span class="vv-tiles">${SV.map(([k, l]) => `<span class="t ${k === 'temp' && parseFloat(sv[k]) >= 38 ? 'alerta' : ''}"><small>${l}</small><b>${esc(sv[k] || '—')}</b></span>`).join('')}${i ? `<span class="t"><small>IMC</small><b>${i}</b></span>` : ''}</span></button>`; };
  const tabs = () => { const n = ses.rx.filter(r => r.estado !== 'descartado').length; return `<div class="vv-tabs" role="tablist"><button role="tab" class="${ses.tab === 'historia' ? 'on' : ''}" data-act="tab" data-v="historia">Historia clínica</button><button role="tab" class="${ses.tab === 'receta' ? 'on' : ''} ${ses.nuevo.rx && ses.tab !== 'receta' ? 'nuevo' : ''}" data-act="tab" data-v="receta">${ses.amb === 'particular' ? 'Receta' : 'Medicamentos'}${n ? `<i>${n}</i>` : ''}</button></div>`; };

  function pintaLineas() {
    return `<div class="vv-h"><span>Transcripción en vivo</span></div>
      <div class="vv-lines" id="vvLines">${ses.trans.length ? ses.trans.slice(-40).map(l => `<div class="ln q-${l.q}${l.prov ? ' prov' : ''}"><b>${l.prov ? 'Recién oído' : QUIEN[l.q]} <small>${mmss(l.s)}</small></b><p>${esc(l.t)}</p></div>`).join('') : `<div class="vv-vacio">${ses.demo ? 'Empieza la demostración…' : 'Empiecen a conversar. Lo que se diga aparecerá aquí unos segundos después.'}</div>`}</div>
      <div class="vv-foot" id="vvTec"></div>`;
  }
  /* solo la columna de transcripción (para mostrar lo recién oído sin redibujar toda la pantalla) */
  function pintaTrans() {
    if (!ses || ses.fin) return;
    const c = $('.vv-trans'); if (!c) return;
    c.innerHTML = pintaLineas();
    const l = $('#vvLines'); if (l) l.scrollTop = l.scrollHeight;
    pintaTec();
  }
  function pintaTec() {
    const e = $('#vvTec'); if (!e || !ses) return;
    const s = ses.stats, med = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '';
    const prom = med(s.lat), tr = med(s.tr), enIpad = ses.local && WSP.est === 'listo';
    e.innerHTML = ses.demo ? 'Demostración: no se usa el micrófono ni internet.'
      : `<span>${enIpad ? 'El audio no sale del iPad: aquí se transcribe y solo se envía el texto.' : 'El audio no se guarda, solo el texto.'}</span><span class="tec">${s.tr.length ? `${s.tr.length} ${s.tr.length === 1 ? 'fragmento transcrito' : 'fragmentos transcritos'} aquí${tr ? ` (${tr} s)` : ''} · ` : ''}${s.n} análisis${prom ? ` · respuesta ${prom} s` : ''}${s.aud && s.tr.length ? ` · ${s.aud} con audio` : ''}${s.sil ? ` · ${s.sil} en silencio` : ''}${s.err ? ` · ${s.err} reintentos` : ''}${s.trErr ? ` · ${s.trErr} fallas de transcripción` : ''}${s.perdido ? ` · ${s.perdido} s sin analizar` : ''}</span>${s.ultErr ? `<span class="err">${esc(s.ultErr)}</span>` : ''}`;
  }
  function pintaHistoria() {
    return `<div class="vv-chead">${tabs()}<div class="vv-leg"><span><i class="ok"></i>Listo</span><span><i class="duda"></i>Por confirmar</span><span><i></i>Falta</span></div></div>
      <div class="vv-scroll">
        <div class="vv-card">${campo('motivo', 'plano')}${campo('padecimiento', 'plano')}</div>
        <div class="vv-grid">${campo('ahf')}${campo('app')}${ses.p.sexo === 'M' ? '' : campo('ago')}${campo('alergias')}${campo('medicamentos')}${campo('estudios')}</div>
        ${svHTML()}
        ${campo('exploracion')}
      </div>`;
  }
  function pintaAsistente() {
    const vacio = !ses.preguntas.length && !ses.explora.length && !ses.dx.length;
    return `<div class="vv-chead"><h3>Asistente clínico</h3><span class="vv-pill">Sugerencias · tú decides</span></div>
      <div class="vv-scroll">${vacio ? '<div class="vv-vacio">Las sugerencias aparecen conforme avanza la conversación.</div>' : ''}
        ${ses.preguntas.length ? `<div class="vv-sec">Pregunta ahora</div>${ses.preguntas.map(t => `<button class="vv-q" data-act="hecha" data-t="${esc(t)}"><i></i><span>${esc(t)}</span></button>`).join('')}` : ''}
        ${ses.explora.map((e, i) => `<div class="vv-exp"><div class="row"><div><small>Explora</small><b>${esc(e.nombre)}</b></div><div class="b"><button class="vv-btn sm" data-act="explora" data-i="${i}" data-r="positivo">Positivo</button><button class="vv-btn sm" data-act="explora" data-i="${i}" data-r="negativo">Negativo</button></div></div>
          <p>${esc(e.como)}</p><small class="f">${esc([e.orienta && 'Orienta a ' + lcFirst(noDot(e.orienta)), e.fuente && (/^conocimiento general$/i.test(e.fuente) ? 'Sugerencia del modelo, sin guía cargada' : e.fuente)].filter(Boolean).join(' · '))}</small></div>`).join('')}
        ${ses.dx.length ? `<div class="vv-sec">Diagnósticos probables<em>Toca uno para usarlo en la nota</em></div>${ses.dx.map((d, i) => `<button class="vv-dx ${norm(d.nombre) === norm(ses.dxSel) ? 'sel' : ''}" data-act="dx" data-i="${i}">
          <span class="row"><b>${esc(d.nombre)}${d.cie10 ? ` <small>${esc(d.cie10)}</small>` : ''}</b>${d.nivel === 'descartar' ? '<span class="desc">Descartar</span>' : `<span class="bars" aria-label="Probabilidad ${d.nivel}">${Array.from({ length: 5 }, (_, j) => `<i class="${j < NIVEL[d.nivel] ? 'on' : ''}"></i>`).join('')}</span>`}</span>
          <span class="d">${esc([d.favor && 'A favor: ' + lcFirst(noDot(d.favor)), d.falta && 'Falta: ' + lcFirst(noDot(d.falta))].filter(Boolean).join('. '))}</span></button>`).join('')}` : ''}
        ${ses.estudiosSug.length ? `<div class="vv-sec">Estudios a considerar</div><div class="vv-est">${ses.estudiosSug.map(e => `<span>${esc(e)}</span>`).join('')}</div>` : ''}
      </div>`;
  }
  const avisos = () => {
    const a = [], f = ses.p.sexo === 'F', ed = ageAt(ses.p.fnac);
    if (!ses.h.alergias) a.push(['Alergias sin registrar', 'Pregunta antes de recetar.', 'alergias']);
    else if (ses.dudas.includes('alergias')) a.push(['Alergias por confirmar', ses.h.alergias, 'alergias']);
    if (f && (ed === null || (ed >= 12 && ed <= 52)) && !/regla|fum|menstru|embaraz|menopaus|histerect|oclusi|otb/i.test(ses.h.ago)) a.push(['Embarazo sin descartar', 'Falta la fecha de última regla.', 'ago']);
    return a;
  };
  const rxOk = () => ses.rx.filter(r => r.estado === 'aceptado' && !r.ctrl);
  const rxProp = () => ses.rx.filter(r => r.estado === 'propuesto');
  const rxCtrl = () => ses.rx.filter(r => r.ctrl && r.estado === 'aceptado');
  function pintaReceta() {
    const s = S.settings, part = ses.amb === 'particular', sv = ses.h.sv, ok = rxOk(), prop = rxProp().filter(r => !r.ctrl), ctrl = rxCtrl();
    return `<div class="vv-chead">${tabs()}<div class="vv-leg"><span>Se llena sola mientras conversan</span></div></div>
      <div class="vv-scroll"><div class="vv-card vv-hoja">
        ${part ? `<div class="vv-membrete"><div><b>${esc(s.medico || '[Nombre de la médica]')}</b><span>${esc(s.recTitulo || 'Médico Cirujano y Partero')}</span><small>${esc(s.recUniversidad || '[Universidad]')} · Cédula profesional ${esc(s.cedula || '[número]')}</small></div>
          <div class="r"><small>${esc(s.recDireccion || '[Dirección del consultorio]')}</small><small>Tel. ${esc(s.recTelefono || '[teléfono]')}</small><small class="m">${s.recUniversidad && s.recDireccion ? 'Datos fijos de tu plantilla' : 'Completa estos datos en Ajustes'}</small></div></div>`
        : `<div class="vv-membrete"><div><b>Lista de apoyo de medicamentos</b><span>No es una receta: úsala como guía para llenar el formato del ISSSTE.</span></div></div>`}
        <div class="vv-datos">
          <span class="d ancho"><small><i class="ok"></i>Paciente</small><b>${esc(ses.p.nombre)}</b></span>
          <span class="d f2"><small><i class="ok"></i>Fecha</small><b>${fmtDM(new Date())} de ${new Date().getFullYear()}</b></span>
          <button class="d ancho" data-act="dxEdit"><small><i class="${ses.fijo.dx ? 'ok' : ses.dxSel ? 'duda' : ''}"></i>Diagnóstico</small><b>${esc(ses.dxSel || 'Por definir')}</b></button>
          <button class="d" data-act="sv"><small><i class="${sv.peso ? 'ok' : ''}"></i>Peso</small><b>${sv.peso ? esc(sv.peso) + ' kg' : '—'}</b></button>
          <button class="d" data-act="sv"><small><i class="${sv.talla ? 'ok' : ''}"></i>Talla</small><b>${sv.talla ? tallaM(sv.talla).toFixed(2) + ' m' : '—'}</b></button>
        </div>
        <div class="vv-rp">Rp.</div>
        ${ok.length || prop.length ? '' : '<div class="vv-vacio">Aquí aparecen los medicamentos que la doctora diga en voz alta y los que acepte de las propuestas.</div>'}
        ${ok.map((r, i) => `<div class="vv-med"><div class="row"><b>${i + 1}. ${esc(r.med)}</b><small>${r.origen === 'dictado' ? 'Dictado por ti' + (r.t !== undefined ? ' · ' + mmss(r.t) : '') : r.origen === 'manual' ? 'Agregado a mano' : 'Propuesta aceptada'}</small></div><p>${esc(r.ind ? endDot(cap(r.ind)) : 'Sin indicación todavía')}</p></div>`).join('')}
        ${prop.map(r => `<div class="vv-med prop"><div class="row"><b>${esc(r.med)}</b><small>Propuesta sin aceptar</small></div><p>${esc(r.ind ? endDot(cap(r.ind)) : '')}</p></div>`).join('')}
        ${ctrl.length ? `<div class="vv-ctrl"><b>Medicamentos controlados (${ctrl.length})</b><span>Requieren su propia receta especial y no se incluyen en ${part ? 'esta plantilla' : 'esta lista'}: ${esc(ctrl.map(r => r.med).join(', '))}.</span></div>` : ''}
        <button class="vv-campo plano ${ses.indic ? 'ok' : 'falta'} ${ses.nuevo.indic ? 'nuevo' : ''}" data-act="indic"><span class="l"><i></i>Indicaciones</span><span class="v">${esc(ses.indic || 'Medidas generales y datos de alarma que le digas al paciente.')}</span></button>
        <div class="vv-hojafoot"><span>${part ? 'Solo se imprime lo que tú aceptaste.' : 'Los controlados se listan aparte.'}</span><button class="vv-btn" data-act="rxNuevo">Agregar medicamento</button></div>
      </div></div>`;
  }
  function pintaMeds() {
    const prop = rxProp(), en = ses.rx.filter(r => r.estado === 'aceptado');
    return `<div class="vv-chead"><h3>Medicamentos</h3><span class="vv-pill">Sugerencias · tú decides</span></div>
      <div class="vv-scroll">
        ${avisos().map(([t, d, k]) => `<button class="vv-aviso" data-act="campo" data-k="${k}"><span><b>${esc(t)}</b><small>${esc(d)}</small></span><em>Registrar</em></button>`).join('')}
        ${prop.map(r => `<div class="vv-exp"><div><small>Propuesta del asistente${r.ctrl ? ' · controlado' : ''}</small><b>${esc(r.med)}</b></div><p>${esc([r.ind && endDot(cap(r.ind)), r.motivo && endDot(cap(r.motivo))].filter(Boolean).join(' '))}</p>
          ${r.ctrl ? '<small class="f">Controlado: si lo indicas, va en su receta especial, no en esta.</small>' : ''}
          <div class="b2"><button class="vv-btn pri sm" data-act="rxOk" data-id="${r.id}">Agregar</button><button class="vv-btn sm" data-act="rxNo" data-id="${r.id}">Descartar</button></div></div>`).join('')}
        ${en.length ? `<div class="vv-sec">Ya indicados</div>${en.map(r => `<div class="vv-en"><div><b>${esc(r.med)}${r.ctrl ? ' <span class="desc">Controlado</span>' : ''}</b><small>${esc(r.ind || 'Sin indicación')}</small></div><div class="b"><button class="vv-btn sm" data-act="rxEdit" data-id="${r.id}">Editar</button><button class="vv-btn sm" data-act="rxNo" data-id="${r.id}">Quitar</button></div></div>`).join('')}` : ''}
        ${!prop.length && !en.length ? '<div class="vv-vacio">Cuando haya un diagnóstico probable, aquí aparecerán propuestas de tratamiento para que las aceptes o descartes.</div>' : ''}
      </div>`;
  }
  function pinta() {
    if (!ses) return;
    if (ses.fin) return pintaCierre();
    const b = $('#vvBody'); if (!b) return;
    b.className = 'vv-body';
    b.innerHTML = `<section class="vv-col vv-trans">${pintaLineas()}</section>
      <section class="vv-col vv-centro">${ses.tab === 'receta' ? pintaReceta() : pintaHistoria()}</section>
      <section class="vv-col vv-der">${ses.tab === 'receta' ? pintaMeds() : pintaAsistente()}</section>`;
    $('#vvAlarma').innerHTML = ses.alarma ? `<div class="vv-alarma" role="alert"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5 16.5 15h-15L9 2.5Z"/><path d="M9 7.5v3.5M9 13.2v.1"/></svg><b>Signo de alarma</b><span>${esc(ses.alarma)}</span></div>` : '';
    const l = $('#vvLines'); if (l) l.scrollTop = l.scrollHeight;
    pintaTec();
  }
  function pendientes() {
    const a = ses.dudas.map(k => [LBL[k] + ': por confirmar', ses.h[k], 'campo', k]);
    if (!ses.h.alergias) a.push(['Alergias', 'No se registraron', 'campo', 'alergias']);
    if (!ses.dxSel) a.push(['Diagnóstico', 'Falta definirlo', 'dxEdit', '']);
    else if (!ses.fijo.dx) a.push(['Diagnóstico: ' + ses.dxSel, 'Lo propuso el asistente: confirma que es el tuyo', 'dxOk', '']);
    const n = rxProp().length; if (n) a.push([`${n} medicamento${n > 1 ? 's' : ''} propuesto${n > 1 ? 's' : ''}`, 'Agrégalos o descártalos abajo', '', '']);
    return a;
  }
  function pintaCierre() {
    const b = $('#vvBody'); if (!b || !ses) return;
    const h = ses.h, sv = h.sv, pen = pendientes(), ok = rxOk(), prop = rxProp(), ctrl = rxCtrl(), part = ses.amb === 'particular';
    const svTxt = [sv.ta && 'TA ' + sv.ta + ' mmHg', sv.fc && 'FC ' + sv.fc + ' lpm', sv.fr && 'FR ' + sv.fr + ' rpm', sv.temp && 'Temp ' + sv.temp + ' °C', sv.sat && 'SpO₂ ' + sv.sat + ' %', sv.peso && 'Peso ' + sv.peso + ' kg', sv.talla && 'Talla ' + tallaM(sv.talla).toFixed(2) + ' m', sv.gluc && 'Glucosa ' + sv.gluc + ' mg/dl'].filter(Boolean).join(' · ');
    $('#vvAlarma').innerHTML = '';
    b.className = 'vv-body cierre';
    b.innerHTML = `<section class="vv-col vv-nota"><div class="vv-chead"><h3>Nota médica</h3><span class="vv-leg"><span>Toca cualquier texto para corregirlo</span></span></div>
        <div class="vv-scroll">${campo('motivo', 'plano')}${campo('padecimiento', 'plano')}
          <div class="vv-grid">${campo('ahf', 'plano')}${campo('app', 'plano')}${ses.p.sexo === 'M' ? '' : campo('ago', 'plano')}${campo('alergias', 'plano')}${campo('medicamentos', 'plano')}${campo('estudios', 'plano')}</div>
          <button class="vv-campo plano ${svTxt ? 'ok' : 'falta'}" data-act="sv"><span class="l"><i></i>Signos vitales</span><span class="v num">${esc(svTxt || 'Sin registrar')}</span></button>
          ${campo('exploracion', 'plano')}
          <button class="vv-campo plano ${ses.fijo.dx ? 'ok' : ses.dxSel ? 'duda' : 'falta'}" data-act="dxEdit"><span class="l"><i></i>Diagnóstico</span><span class="v grande">${esc(ses.dxSel || 'Por definir')}</span></button>
          <button class="vv-campo plano ${ses.plan ? 'ok' : 'falta'}" data-act="plan"><span class="l"><i></i>Plan</span><span class="v">${esc(ses.plan || 'Sin registrar')}</span></button>
          <p class="vv-pie">${ses.demo ? 'Demostración con datos ficticios: no se guarda nada.' : `Consentimiento verbal para usar el asistente de escucha, ${esc(ses.consent?.hora || '')} h. Nota redactada con apoyo del asistente; revísala antes de guardar. El audio ya se eliminó.`}</p>
        </div></section>
      <section class="vv-col vv-der"><div class="vv-scroll">
        ${pen.length ? `<div class="vv-pend"><b>${pen.length} dato${pen.length > 1 ? 's' : ''} por revisar antes de guardar</b>${pen.map(([t, d, act, k]) => `<div class="p"><span><b>${esc(t)}</b><small>${esc(d)}</small></span>${act ? `<button class="vv-btn sm" data-act="${act}" data-k="${k}">${act === 'dxOk' ? 'Confirmar' : 'Revisar'}</button>` : ''}</div>`).join('')}</div>` : '<div class="vv-listo">Todo revisado. Puedes guardar la consulta.</div>'}
        <div class="vv-card"><div class="vv-sec" style="margin-top:0">${part ? 'Receta médica' : 'Medicamentos (lista de apoyo)'}</div>
          ${ok.length ? ok.map((r, i) => `<div class="vv-en"><div><b>${i + 1}. ${esc(r.med)}</b><small>${esc(r.ind || 'Sin indicación')}</small></div><div class="b"><button class="vv-btn sm" data-act="rxEdit" data-id="${r.id}">Editar</button></div></div>`).join('') : '<div class="vv-vacio">Sin medicamentos indicados.</div>'}
          ${prop.map(r => `<div class="vv-en prop"><div><b>${esc(r.med)}${r.ctrl ? ' <span class="desc">Controlado</span>' : ''}</b><small>${esc(r.ind || '')}</small></div><div class="b"><button class="vv-btn pri sm" data-act="rxOk" data-id="${r.id}">Agregar</button><button class="vv-btn sm" data-act="rxNo" data-id="${r.id}">Descartar</button></div></div>`).join('')}
          ${ctrl.length ? `<div class="vv-ctrl"><b>Controlados</b><span>${esc(ctrl.map(r => r.med).join(', '))}: van en su receta especial.</span></div>` : ''}
          <div class="b2" style="margin-top:10px"><button class="vv-btn" data-act="rxNuevo">Agregar medicamento</button>
            <button class="vv-btn pri" data-act="${part ? 'word' : 'lista'}" ${ok.length ? '' : 'disabled'}>${part ? 'Receta en Word' : 'Ver lista de apoyo'}</button></div></div>
      </div></section>`;
  }

  /* ---------------- acciones ---------------- */
  function editarTexto(titulo, valor, alGuardar, { ayuda = '', chips = [] } = {}) {
    const sh = openSheet(`<div class="shead"><h2>${esc(titulo)}</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      ${ayuda ? `<p class="hint" style="margin-bottom:10px">${esc(ayuda)}</p>` : ''}
      ${chips.length ? `<div class="chips" style="margin-bottom:10px">${chips.map(c => `<button type="button" class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      <div class="form"><div class="f"><textarea id="vvTxt" style="min-height:110px"></textarea></div></div>
      <div class="sticky-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, { small: true });
    const ta = $('#vvTxt', sh); ta.value = valor || '';
    $$('[data-chip]', sh).forEach(c => c.onclick = () => { ta.value = c.dataset.chip; });
    $$('[data-close]', sh).forEach(b => b.onclick = closeSheet);
    $('[data-ok]', sh).onclick = () => { closeSheet(); alGuardar(ta.value.trim()); pinta(); };
    setTimeout(() => ta.focus(), 60);
  }
  function editarSV() {
    const d = { sv: { ...ses.h.sv } };
    const sh = openSheet(`<div class="shead"><h2>Signos vitales</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      ${vitalsHTML('sv')}<div class="sticky-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`);
    bindForm(sh, d);
    $$('[data-close]', sh).forEach(b => b.onclick = closeSheet);
    $('[data-ok]', sh).onclick = () => { SV.forEach(([k]) => { const v = txt(d.sv[k]); if (v !== (ses.h.sv[k] || '')) { ses.h.sv[k] = v; ses.fijo['sv.' + k] = true; } }); closeSheet(); pinta(); };
  }
  function editarRx(id) {
    const it = id ? ses.rx.find(r => r.id === id) : null, d = { med: it?.med || '', ind: it?.ind || '' };
    const sh = openSheet(`<div class="shead"><h2>${it ? 'Editar medicamento' : 'Agregar medicamento'}</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      <div class="form"><div class="f"><label for="rxm">Medicamento y presentación</label><input id="rxm" type="text" data-b="med" placeholder="Ej.: Paracetamol 500 mg, tabletas"></div>
      <div class="f"><label for="rxi">Indicación</label><textarea id="rxi" data-b="ind" style="min-height:80px" placeholder="Ej.: Tomar 1 tableta cada 8 horas por 3 días"></textarea></div></div>
      <div class="sticky-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, { small: true });
    bindForm(sh, d);
    $$('[data-close]', sh).forEach(b => b.onclick = closeSheet);
    $('[data-ok]', sh).onclick = () => {
      const med = d.med.trim(); if (!med) return toast('Escribe el medicamento');
      if (it) Object.assign(it, { med, ind: d.ind.trim(), k: rxKey(med), estado: 'aceptado', fijo: true, ctrl: CONTROLADOS.test(med) || (it.ctrl && rxKey(med) === it.k) });
      else ses.rx.push({ id: uid(), k: rxKey(med), med, ind: d.ind.trim(), origen: 'manual', estado: 'aceptado', fijo: true, ctrl: CONTROLADOS.test(med), motivo: '' });
      closeSheet(); pinta();
    };
  }
  function clic(e) {
    const b = e.target.closest('[data-act]'); if (!b || !ses) return;
    const a = b.dataset.act, k = b.dataset.k, rx = b.dataset.id && ses.rx.find(r => r.id === b.dataset.id);
    if (a === 'tab') { ses.tab = b.dataset.v; if (ses.tab === 'receta') delete ses.nuevo.rx; pinta(); }
    else if (a === 'pausa') pausa();
    else if (a === 'salud') verSalud();
    else if (a === 'micOk') reabrirMic();
    else if (a === 'fin') finalizar();
    else if (a === 'volver') volver();
    else if (a === 'guardar') guardar();
    else if (a === 'descartar') confirmBox(ses.demo ? 'Se cerrará la demostración.' : 'Se perderá todo lo capturado en esta consulta. No se puede deshacer.', { ok: ses.demo ? 'Cerrar' : 'Descartar consulta', danger: !ses.demo }).then(ok => ok && cerrar());
    else if (a === 'campo') editarTexto(LBL[k], ses.h[k], v => { ses.h[k] = v; ses.fijo[k] = true; ses.dudas = ses.dudas.filter(x => x !== k); }, { ayuda: 'Lo que escribas aquí ya no lo cambia el asistente.' });
    else if (a === 'sv') editarSV();
    else if (a === 'indic') editarTexto('Indicaciones', ses.indic, v => { ses.indic = v; ses.fijo.indic = true; });
    else if (a === 'plan') editarTexto('Plan', ses.plan, v => { ses.plan = v; ses.fijo.plan = true; });
    else if (a === 'dxEdit') editarTexto('Diagnóstico', ses.dxSel, v => { ses.dxSel = v; ses.fijo.dx = !!v; }, { chips: ses.dx.map(d => d.nombre) });
    else if (a === 'dxOk') { ses.fijo.dx = true; pinta(); }
    else if (a === 'dx') { ses.dxSel = ses.dx[+b.dataset.i].nombre; ses.fijo.dx = true; pinta(); }
    else if (a === 'hecha') { ses.hechas.push(norm(b.dataset.t)); ses.preguntas = ses.preguntas.filter(t => t !== b.dataset.t); pinta(); }
    else if (a === 'explora') {
      const ex = ses.explora[+b.dataset.i]; if (!ex) return;
      ses.h.exploracion = [ses.h.exploracion && endDot(ses.h.exploracion), `${cap(ex.nombre)} ${b.dataset.r}.`].filter(Boolean).join(' ');
      ses.hechas.push(norm(ex.nombre)); ses.explora.splice(+b.dataset.i, 1); ses.nuevo.exploracion = 1; pinta();
    }
    else if (a === 'rxOk' && rx) { rx.estado = 'aceptado'; rx.origen = 'aceptada'; pinta(); }
    else if (a === 'rxNo' && rx) { rx.estado = 'descartado'; pinta(); }
    else if (a === 'rxEdit' && rx) editarRx(rx.id);
    else if (a === 'rxNuevo') editarRx(null);
    else if (a === 'word') runExport(() => recetaDocx(datosReceta()));
    else if (a === 'lista') listaApoyo(datosReceta());
  }

  /* ---------------- cierre: pasa lo capturado a la hoja de consulta de la app ---------------- */
  function datosReceta() {
    const sv = ses.h.sv;
    return { p: ses.p, fecha: iso(new Date()), dx: ses.dxSel, peso: sv.peso || '', talla: sv.talla ? tallaM(sv.talla).toFixed(2) : '', items: rxOk().map(r => ({ med: r.med, ind: r.ind })), ctrl: rxCtrl().map(r => r.med), indic: ses.indic };
  }
  async function guardar() {
    const s = ses;
    if (s.demo) return cerrar();
    if (pend(s) && !await confirmBox((!navigator.onLine || s.sinRed ? 'No hay internet, así que lo último que se dijo no se ha podido analizar. ' : 'Todavía se está analizando lo último que se dijo. ') + 'Si guardas ahora, puede no quedar en la nota.', { ok: 'Guardar de todos modos', title: 'Falta lo último' })) return;
    if (ses !== s) return;
    const h = s.h, ok = s.rx.filter(r => r.estado === 'aceptado');
    const pre = {
      nota: [h.motivo && endDot(cap(h.motivo)), h.padecimiento && endDot(cap(h.padecimiento)), h.estudios && 'Estudios previos: ' + endDot(lcFirst(h.estudios))].filter(Boolean).join(' '),
      sv: { ...h.sv, talla: h.sv.talla ? tallaM(h.sv.talla).toFixed(2) : '' }, exploracion: h.exploracion || '', dxIssste: s.dxSel || '',
      plan: [s.plan && endDot(cap(s.plan)), ok.length && 'Tratamiento: ' + ok.map(r => r.med + (r.ind ? ', ' + lcFirst(noDot(r.ind)) : '')).join('; ') + '.', s.indic && 'Indicaciones: ' + endDot(lcFirst(s.indic))].filter(Boolean).join(' '),
      lab: !!s.lab, img: !!s.img, meds: ok.length,
      vivo: { h: JSON.parse(JSON.stringify(h)), rx: ok.map(r => ({ med: r.med, ind: r.ind, ctrl: !!r.ctrl })), indic: s.indic, consent: s.consent, dur: s.seg, modelo: cfg.model, voz: s.stats.tr.length ? 'whisper-' + WSP.modelo : 'gemini' }
    };
    const pid = s.p.id; cerrar();
    openConsulta({ patientId: pid, prefill: pre });
    toast('Revisa la hoja y guarda la consulta');
  }
  /* completa antecedentes del paciente solo donde estaban vacíos */
  function aplicarAntecedentes(p, h) {
    if (!p || !h) return; p.antecedentes ??= {};
    [['ahf', 'ahf'], ['patologicos', 'app'], ['alergicos', 'alergias'], ['tratamiento', 'medicamentos'], ['gineco', 'ago']].forEach(([a, k]) => {
      if (!p.antecedentes[a] && h[k] && !(a === 'patologicos' && cronActivo(p)) && !(a === 'tratamiento' && cronActivo(p))) p.antecedentes[a] = h[k];
    });
  }
  function recetaDeConsulta(c, p) {
    const v = c.vivo || {}, d = { p, fecha: c.fecha, dx: c.dxIssste || '', peso: c.sv?.peso || '', talla: c.sv?.talla || '', items: arr(v.rx).filter(r => !r.ctrl), ctrl: arr(v.rx).filter(r => r.ctrl).map(r => r.med), indic: v.indic || '' };
    if (AMB === 'particular') runExport(() => recetaDocx(d)); else listaApoyo(d);
  }
  function listaApoyo(d) {
    const lineas = [...d.items.map((r, i) => `${i + 1}. ${r.med}${r.ind ? ' — ' + endDot(cap(r.ind)) : ''}`), ...(d.ctrl.length ? ['Controlados (receta especial): ' + d.ctrl.join(', ')] : []), ...(d.indic ? ['Indicaciones: ' + endDot(cap(d.indic))] : [])];
    const sh = openSheet(`<div class="shead"><h2>Lista de apoyo de medicamentos</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
      <p class="hint" style="margin-bottom:12px">${esc(d.p.nombre)} · ${esc(d.dx || 'Sin diagnóstico')}. No es una receta: úsala para llenar el formato del ISSSTE.</p>
      ${lineas.length ? `<ol class="vv-lista">${lineas.map(l => `<li>${esc(l.replace(/^\d+\.\s/, ''))}</li>`).join('')}</ol>` : '<div class="empty"><b>Sin medicamentos</b></div>'}
      <div class="sticky-actions"><button class="btn ghost" data-close>Cerrar</button><button class="btn primary" data-copy>Copiar lista</button></div>`, { small: true });
    $$('[data-close]', sh).forEach(b => b.onclick = closeSheet);
    $('[data-copy]', sh).onclick = async () => { try { await navigator.clipboard.writeText(lineas.join('\n')); toast('Lista copiada'); } catch (e) { toast('No se pudo copiar'); } };
  }
  /* --------- Receta en Word: encabezado fijo de Ajustes + datos de la consulta --------- */
  async function recetaDocx(d) {
    const docx = await libDOCX(), w = W(docx), s = S.settings, { Paragraph, AlignmentType, BorderStyle } = docx;
    const der = AlignmentType.RIGHT, cen = AlignmentType.CENTER, gris = '5A5880';
    const dato = (l, v, wpc) => w.C([w.P(l, { size: 7.5, color: gris, bold: true }), w.P(v || ' ', { size: 11.5, bold: true })], { w: wpc, under: true });
    const kids = [
      w.T([[w.C([w.P(s.medico || '', { bold: true, size: 15 }), w.P(s.recTitulo || '', { size: 11 }), w.P([s.recUniversidad, s.cedula && 'Cédula profesional ' + s.cedula].filter(Boolean).join('  ·  '), { size: 9, color: gris })], { w: 60 }),
        w.C([w.P(s.recDireccion || '', { size: 9, color: gris, align: der }), w.P(s.recTelefono ? 'Tel. ' + s.recTelefono : '', { size: 9, color: gris, align: der })], { w: 40 })]]),
      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: '635BFF', space: 1 } }, spacing: { after: 200 } }),
      w.T([[dato('PACIENTE', d.p.nombre, 62), dato('FECHA', fmtLong(d.fecha).replace(/^\S+\s/, ''), 38)]]),
      w.P('', { size: 4 }),
      w.T([[dato('DIAGNÓSTICO', d.dx, 62), dato('PESO', d.peso ? d.peso + ' kg' : '', 19), dato('TALLA', d.talla ? d.talla + ' m' : '', 19)]]),
      w.P('Rp.', { bold: true, italic: true, size: 18, color: '635BFF', before: 360, after: 120 })
    ];
    d.items.forEach((r, i) => { kids.push(w.P(`${i + 1}. ${r.med}`, { bold: true, size: 12, before: 100 })); kids.push(w.P(r.ind ? endDot(cap(r.ind)) : ' ', { size: 11, after: 160 })); });
    if (d.indic) { kids.push(w.P('INDICACIONES', { bold: true, size: 8, color: gris, before: 260, after: 60 })); kids.push(w.P(endDot(cap(d.indic)), { size: 11 })); }
    kids.push(w.P('', { before: 1100 }), w.P('_______________________________', { align: cen }), w.P(s.medico || '', { align: cen, size: 10, bold: true, before: 60 }),
      w.P(s.cedula ? 'Cédula profesional ' + s.cedula : '', { align: cen, size: 9, color: gris }));
    await deliver(await docxBlob(docx, kids), `Receta_${safeName(d.p.nombre)}_${d.fecha}.docx`);
  }

  /* ---------------- demostración (consulta ficticia, sin micrófono ni internet) ---------------- */
  const DEMO = [
    { s: 12, transcripcion: [{ quien: 'medico', texto: 'Buenas tardes, ¿qué la trae hoy a consulta?' }, { quien: 'paciente', texto: 'Traigo un dolor aquí, debajo de las costillas del lado derecho, desde antier en la noche.' }],
      historia: { motivo: 'Dolor en hipocondrio derecho de 2 días de evolución.' }, preguntas: ['¿El dolor empezó después de comer algo en particular?', '¿Ha tenido náusea, vómito o fiebre?', '¿Qué medicamentos toma? ¿Es alérgica a alguno?'],
      diagnosticos: [{ nombre: 'Cólico biliar por colelitiasis', nivel: 'medio', a_favor: 'dolor en hipocondrio derecho', falta: 'relación con alimentos, duración del dolor' }] },
    { s: 65, transcripcion: [{ quien: 'medico', texto: '¿Empezó después de comer algo en particular?' }, { quien: 'paciente', texto: 'Sí, cenamos carnitas y como a las dos horas me empezó. Vomité dos veces.' }, { quien: 'acompanante', texto: 'Anoche la sentí con calentura, doctora, pero no le tomamos la temperatura.' }],
      historia: { motivo: 'Dolor en hipocondrio derecho de 2 días de evolución.', padecimiento: 'Inicia hace 2 días, unas 2 horas después de una cena abundante en grasa. Náusea y vómito en 2 ocasiones. Fiebre referida por la acompañante, no cuantificada.' },
      alarma: 'Fiebre + dolor en hipocondrio derecho: busca ictericia y pregunta por coluria. Si hay, piensa en colangitis y refiere a urgencias.',
      preguntas: ['¿Orina oscura, heces claras u ojos amarillos?', '¿Ha tenido cuadros parecidos después de comer?', '¿Qué medicamentos toma? ¿Es alérgica a alguno?'],
      exploracion_sugerida: [{ nombre: 'Signo de Murphy', como: 'Presiona el punto cístico (bajo el borde costal derecho, línea medioclavicular) mientras inspira profundo. Positivo si corta la inspiración por dolor.', orienta: 'colecistitis aguda', fuente: 'GPC Colecistitis y colelitiasis' }],
      diagnosticos: [{ nombre: 'Colecistitis aguda', cie10: 'K81.0', nivel: 'alto', a_favor: 'dolor posprandial, fiebre, vómito', falta: 'Murphy y ultrasonido' }, { nombre: 'Cólico biliar por colelitiasis', nivel: 'bajo', a_favor: 'relación con comida grasosa', falta: 'en contra: más de 6 horas de dolor y fiebre' }, { nombre: 'Coledocolitiasis o colangitis', nivel: 'descartar', a_favor: '', falta: 'ictericia, coluria, pruebas de función hepática' }],
      estudios_sugeridos: ['Ultrasonido de hígado y vías biliares', 'Biometría hemática', 'Pruebas de función hepática', 'Lipasa'] },
    { s: 190, transcripcion: [{ quien: 'medico', texto: '¿Toma algún medicamento? ¿Su mamá o sus hermanos han tenido piedras en la vesícula?' }, { quien: 'paciente', texto: 'No tomo nada. A mi mamá la operaron de la vesícula. Tengo tres hijos, todos por parto.' }, { quien: 'medico', texto: 'Tensión 128 sobre 82, frecuencia 96, respiraciones 20, temperatura 38.1, satura 96, pesa 78 kilos y mide 1.58.' }],
      historia: { ahf: 'Madre con colelitiasis, operada.', app: 'Niega enfermedades crónicas y cirugías.', ago: 'G3 P3.', medicamentos: 'Ninguno.', sv: { ta: '128/82', fc: '96', fr: '20', temp: '38.1', sat: '96', peso: '78', talla: '1.58' } }, por_confirmar: [],
      alarma: 'Fiebre + dolor en hipocondrio derecho: busca ictericia y pregunta por coluria. Si hay, piensa en colangitis y refiere a urgencias.',
      preguntas: ['¿Orina oscura, heces claras u ojos amarillos?', '¿Es alérgica a algún medicamento?', '¿Cuándo fue su última regla?'] },
    { s: 420, transcripcion: [{ quien: 'medico', texto: '¿El dolor se le va hacia la espalda o hacia el hombro?' }, { quien: 'paciente', texto: 'Sí, como hacia la paletilla derecha, y me duele más cuando respiro hondo. La orina y los ojos los tengo normales.' }, { quien: 'medico', texto: 'Escleras sin ictericia. Abdomen blando, depresible, doloroso en hipocondrio derecho, Murphy positivo, sin irritación peritoneal. Giordano negativo.' }],
      historia: { padecimiento: 'Inicia hace 2 días, unas 2 horas después de una cena abundante en grasa. Náusea y vómito en 2 ocasiones. Fiebre referida por la acompañante, no cuantificada. Irradia a escápula derecha y aumenta con la inspiración profunda. Niega coluria, acolia e ictericia.', exploracion: 'Escleras sin ictericia. Abdomen blando, depresible, doloroso a la palpación en hipocondrio derecho, signo de Murphy positivo, sin datos de irritación peritoneal. Giordano negativo.' },
      alarma: '', exploracion_sugerida: [], preguntas: ['¿Es alérgica a algún medicamento?', '¿Cuándo fue su última regla?'],
      diagnosticos: [{ nombre: 'Colecistitis aguda', cie10: 'K81.0', nivel: 'alto', a_favor: 'dolor posprandial, fiebre, Murphy positivo', falta: 'ultrasonido' }, { nombre: 'Coledocolitiasis', nivel: 'descartar', a_favor: '', falta: 'pruebas de función hepática y ultrasonido' }],
      estudios_sugeridos: ['Ultrasonido de hígado y vías biliares', 'Biometría hemática', 'Pruebas de función hepática', 'Lipasa'] },
    { s: 652, transcripcion: [{ quien: 'medico', texto: 'Le voy a pedir un ultrasonido y unos análisis de sangre hoy mismo, y la voy a mandar con el cirujano.' }, { quien: 'medico', texto: 'Mientras tanto le voy a dar butilhioscina, una tableta cada ocho horas por tres días.' }, { quien: 'paciente', texto: '¿Y para la calentura, doctora?' }, { quien: 'medico', texto: 'Nada de grasas ni irritantes. Y si se pone amarilla o el dolor aumenta, se va directo a urgencias.' }],
      historia: {}, preguntas: ['¿Es alérgica a algún medicamento?', '¿Cuándo fue su última regla?'],
      diagnosticos: [{ nombre: 'Colecistitis aguda', cie10: 'K81.0', nivel: 'alto', a_favor: 'dolor posprandial, fiebre, Murphy positivo', falta: 'ultrasonido' }, { nombre: 'Coledocolitiasis', nivel: 'descartar', a_favor: '', falta: 'pruebas de función hepática y ultrasonido' }],
      estudios_solicitados: { laboratorio: true, imagen: true }, plan: 'Ultrasonido de hígado y vías biliares, biometría hemática, pruebas de función hepática y lipasa. Referencia a segundo nivel para valoración por cirugía general. Se explican datos de alarma',
      receta: { dictados: [{ medicamento: 'Butilhioscina 10 mg, tabletas', indicacion: 'Tomar 1 tableta cada 8 horas por 3 días' }], propuestas: [{ medicamento: 'Paracetamol 500 mg, tabletas', indicacion: 'Tomar 1 tableta cada 8 horas por 3 días, en caso de fiebre o dolor', motivo: 'Para la fiebre que preguntó la paciente' }],
        indicaciones: 'Dieta sin grasas ni irritantes. Acudir a urgencias si presenta piel u ojos amarillos, fiebre que no cede o aumento del dolor' } }
  ];
  function demo() {
    const d = new Date(); d.setFullYear(d.getFullYear() - 46);
    abrir({ id: 'demo', nombre: 'María Elena R.', sexo: 'F', fnac: iso(d), expediente: '', antecedentes: {} }, true, { hora: nowTime(), acomp: true });
  }
  function correrDemo() {
    const s = ses; s.demoT = [];
    DEMO.forEach((paso, i) => s.demoT.push(setTimeout(() => { if (ses !== s || s.fin) return; s.seg = paso.s; aplicar(paso, paso.s); const t = $('#vvT'); if (t) t.textContent = mmss(s.seg); }, 1200 + i * 3800)));
  }

  /* ---------------- tarjeta de Ajustes ---------------- */
  function ajustesHTML() {
    const seg = (id, ops) => `<div class="seg" id="${id}">${ops.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('')}</div>`;
    return `<section class="card milk"><h2 style="margin-bottom:6px">Consulta en vivo (asistente)</h2>
      <p class="hint" style="margin-bottom:14px">La tableta transcribe la consulta aquí mismo y a Gemini solo le envía el texto para llenar la historia y proponer: el audio no sale del iPad ni se guarda. Si la transcripción en el iPad no está preparada o falla, se envía el audio a Gemini (funciona, pero más lento). La clave vive solo en este iPad, sirve para los dos consultorios y no viaja en los respaldos. <b>Con la clave gratuita usa solo consultas simuladas</b>: Google puede usar ese contenido para mejorar sus productos.</p>
      <div class="form">
        <div class="f s8"><label for="vvKey">Clave de Gemini (API key de Google AI Studio)</label><input id="vvKey" type="password" autocomplete="off" placeholder="Pega aquí la clave"></div>
        <div class="f s4"><span class="lbl">Pruebas</span><div class="row wrap"><button type="button" class="btn primary" id="vvTest">Probar conexión</button><button type="button" class="btn soft" id="vvDemo">Ver demostración</button></div></div>
        <div class="f s8"><label for="vvModel">Modelo de Gemini</label><div class="row"><input id="vvModel" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" style="flex:1;min-width:0"><button type="button" class="btn soft" id="vvModels">Ver modelos</button></div><div class="chips" id="vvList" style="margin-top:8px"></div></div>
        <div class="f s4"><span class="lbl">Respuesta de Gemini</span>${seg('vvRap', [['1', 'Rápida'], ['0', 'Más razonada']])}</div>
      </div><p class="hint" id="vvMsg" style="margin:10px 0 18px" role="status"></p>
      <h3 style="margin:0 0 6px;font-size:17px">Transcripción de la voz</h3>
      <p class="hint" style="margin-bottom:14px">«En el iPad» usa un modelo de voz (Whisper) que se descarga una sola vez con internet y después funciona sin conexión. «Rápido» pesa menos y responde antes; «Preciso» entiende mejor el español, pero pesa unas tres veces más. Prepara el que elijas y pruébalo con tu voz.</p>
      <div class="form">
        <div class="f s6"><span class="lbl">Dónde se transcribe</span>${seg('vvModo', [['local', 'En el iPad'], ['audio', 'Enviar audio a Gemini']])}</div>
        <div class="f s6"><span class="lbl">Modelo de voz del iPad</span>${seg('vvWm', [['base', 'Rápido'], ['small', 'Preciso']])}</div>
        <div class="f"><div class="row wrap"><button type="button" class="btn primary" id="vvPrep">Preparar transcripción</button><button type="button" class="btn soft" id="vvOir">Probar con mi voz (5 s)</button></div>
          <div class="vv-barra" id="vvBarra" hidden><i></i></div><p class="hint" id="vvWmsg" style="margin-top:8px" role="status"></p></div>
        <div class="f s4"><span class="lbl">Analizar con Gemini cada</span>${seg('vvCada', [['10', '10 s'], ['20', '20 s'], ['40', '40 s']])}</div>
        <div class="f s4"><span class="lbl">Fragmento máximo de voz</span>${seg('vvSeg', [['15', '15 s'], ['20', '20 s'], ['30', '30 s']])}</div>
        <div class="f s4"><span class="lbl">Aviso sonoro si algo falla</span>${seg('vvBeep', [['1', 'Sí'], ['0', 'No']])}</div>
      </div>
      <p class="hint" style="margin-top:10px">Analizar más seguido da sugerencias más pronto, pero gasta más solicitudes del plan gratuito de Gemini. Lo que se va oyendo aparece en pantalla de inmediato en cualquier caso.</p></section>`;
  }
  /* graba unos segundos del micrófono y los transcribe en el iPad: sirve para comprobar que el modelo de voz funciona y qué tan rápido */
  async function probarVoz(msg) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar el micrófono desde la app');
    const ac = new AC(); ac.resume?.().catch(() => { });                 // dentro del toque (requisito de Safari)
    let stream;
    try {
      await wspCargar();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const src = ac.createMediaStreamSource(stream), sp = ac.createScriptProcessor(4096, 1, 1), mute = ac.createGain(), bufs = []; let len = 0;
      mute.gain.value = 0; sp.onaudioprocess = ev => { const f = new Float32Array(ev.inputBuffer.getChannelData(0)); bufs.push(f); len += f.length; };
      src.connect(sp); sp.connect(mute); mute.connect(ac.destination);
      if (ac.state === 'suspended') await ac.resume().catch(() => { });
      for (let i = 5; i > 0; i--) { msg(`Habla ahora, como en una consulta… ${i}`); await new Promise(r => setTimeout(r, 1000)); }
      sp.disconnect(); src.disconnect();
      if (!len) throw new Error('El micrófono no entregó audio');
      const pcm = a16k(bufs, len, ac.sampleRate), f = Float32Array.from(pcm, v => v / 32768);
      msg('Transcribiendo…');
      const t0 = performance.now(), m = await wspTr(f), t = limpia(m.texto);
      msg(`${t ? `Se entendió: «${t}»` : 'No se detectó voz (habla más cerca del iPad e inténtalo de nuevo)'} · tardó ${((performance.now() - t0) / 1000).toFixed(1)} s ${WSP.dev === 'webgpu' ? 'con GPU' : 'sin GPU'}.`);
    } finally { try { stream?.getTracks().forEach(t => t.stop()); } catch (e) { } ac.close().catch(() => { }); }
  }
  async function ajustesBind() {
    await cargarCfg();
    const key = $('#vvKey'), mod = $('#vvModel'), msg = t => { const m = $('#vvMsg'); if (m) m.textContent = t; };
    if (!key) return;
    key.value = cfg.apiKey; mod.value = cfg.model;
    /* controles de opción: [id, valor actual, al elegir] */
    const segs = [['vvSeg', () => cfg.seg, v => cfg.seg = +v], ['vvCada', () => cfg.cada, v => cfg.cada = +v], ['vvRap', () => +cfg.rapido, v => cfg.rapido = v === '1'],
      ['vvBeep', () => +cfg.beep, v => cfg.beep = v === '1'], ['vvModo', () => cfg.modo, v => cfg.modo = v], ['vvWm', () => cfg.wmodelo, v => cfg.wmodelo = v]];
    const pSeg = () => segs.forEach(([id, get]) => $$(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === String(get()))));
    segs.forEach(([id, , set]) => $$(`#${id} button`).forEach(b => b.onclick = () => { set(b.dataset.v); guardarCfg(); previo.t = 0; pSeg(); pVoz(); }));
    /* estado del modelo de voz; se refresca solo mientras descarga */
    let nota = '';
    const pVoz = () => {
      const m = $('#vvWmsg'), barra = $('#vvBarra'); if (!m) return WSP.oyentes.delete(pVoz);
      const mo = cfg.wmodelo, nom = mo === 'base' ? 'Rápido' : 'Preciso', gpu = 'gpu' in navigator, tot = TAM[mo][gpu ? 'webgpu' : 'wasm'], cargandoEste = WSP.est === 'cargando' && WSP.cargando === mo;
      const mb = Math.round(WSP.bytes / 1048576), dev = d => d === 'webgpu' ? 'con aceleración por GPU' : 'con el procesador (sin GPU: más lenta)';
      barra.hidden = !cargandoEste; if (cargandoEste) barra.firstElementChild.style.width = Math.min(100, Math.round(mb / tot * 100)) + '%';
      $('#vvPrep').disabled = cargandoEste; $('#vvOir').disabled = WSP.est === 'cargando';
      m.textContent = cfg.modo !== 'local' ? 'Ahora se envía el audio a Gemini. Elige «En el iPad» para transcribir aquí y enviar solo texto.'
        : cargandoEste ? (mb ? `Descargando el modelo de voz «${nom}»: ${mb} de unos ${tot} MB. No cierres la app.` : `Cargando el modelo de voz «${nom}»…`)
        : WSP.est === 'listo' && WSP.modelo === mo ? `Lista: modelo «${nom}» ${dev(WSP.dev)}.${nota ? ' ' + nota : ''}`
        : WSP.est === 'error' ? `No se pudo preparar: ${WSP.err}. Mientras tanto la consulta envía el audio a Gemini.`
        : cfg.wlisto[mo] ? `Preparada en este iPad: modelo «${nom}» ${dev(cfg.wlisto[mo])}. Se carga sola al iniciar una consulta.`
        : `Sin preparar: el modelo «${nom}» descarga unos ${tot} MB una sola vez. Hazlo con buen internet; hasta entonces la consulta envía el audio a Gemini.`;
    };
    WSP.oyentes.add(pVoz);
    $('#vvPrep').onclick = () => { nota = ''; wspCargar().catch(e => console.error(e)); };
    $('#vvOir').onclick = async () => {
      nota = ''; const b = $('#vvOir'); b.disabled = true;
      try { await probarVoz(t => { nota = t; const m = $('#vvWmsg'); if (m && WSP.est === 'listo') m.textContent = t; }); }
      catch (e) { console.error(e); nota = ''; const m = $('#vvWmsg'); if (m && WSP.est !== 'error') m.textContent = 'No se pudo probar: ' + (e.name === 'NotAllowedError' ? 'falta el permiso del micrófono' : e.message) + '.'; }
      finally { if (b.isConnected) b.disabled = WSP.est === 'cargando'; }
    };
    pSeg(); pVoz();
    key.oninput = () => { cfg.apiKey = key.value.trim(); guardarCfg(); previo.t = 0; };
    mod.oninput = () => { cfg.model = mod.value.trim().replace(/^models\//, ''); guardarCfg(); };
    $('#vvDemo').onclick = () => demo();
    $('#vvTest').onclick = async () => {
      if (!cfg.apiKey) return msg('Primero pega la clave de Gemini.');
      msg('Probando…'); const t0 = performance.now();
      try { textoDe(await gem(`/${encodeURIComponent(cfg.model)}:generateContent`, { contents: [{ role: 'user', parts: [{ text: 'Responde solo: OK' }] }] }, 25000)); msg(`Conexión correcta con ${cfg.model}: respondió en ${((performance.now() - t0) / 1000).toFixed(1)} s.`); }
      catch (e) { msg('No se pudo conectar: ' + e.message + '.'); }
    };
    $('#vvModels').onclick = async () => {
      if (!cfg.apiKey) return msg('Primero pega la clave de Gemini.');
      msg('Buscando modelos…');
      try {
        const d = await gem('?pageSize=200', null, 25000);
        const ms = arr(d.models).filter(m => arr(m.supportedGenerationMethods).includes('generateContent') && /flash/i.test(m.name) && !/image|tts|live|embedding|audio-dialog/i.test(m.name)).map(m => m.name.replace(/^models\//, ''));
        $('#vvList').innerHTML = ms.map(m => `<button type="button" class="chip ${m === cfg.model ? 'on' : ''}" data-m="${esc(m)}">${esc(m)}</button>`).join('');
        $$('[data-m]', $('#vvList')).forEach(b => b.onclick = () => { cfg.model = b.dataset.m; mod.value = cfg.model; guardarCfg(); $$('[data-m]', $('#vvList')).forEach(x => x.classList.toggle('on', x === b)); });
        msg(ms.length ? 'Elige un modelo Flash de la lista y usa «Probar conexión».' : 'La clave funciona, pero no se encontraron modelos Flash.');
      } catch (e) { msg('No se pudo consultar la lista: ' + e.message + '.'); }
    };
  }

  return { MIC, iniciar, demo, ajustesHTML, ajustesBind, recetaDeConsulta, aplicarAntecedentes, pintarBoton, _t: { get ses() { return ses; }, cfg, cargarCfg, aplicar, a16k, wavB64, WSP, wspCargar, limpia, salud, chequeoPrevio, previo } };
})();
