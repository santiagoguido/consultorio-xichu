// Transcripción de voz dentro del iPad (Whisper). Corre en un hilo aparte para no trabar la pantalla.
// El audio nunca sale del dispositivo: este archivo solo devuelve texto a la app.
// La primera vez descarga el modelo de voz (Hugging Face) y el motor (jsDelivr); después quedan guardados en el iPad.
import { pipeline, env } from './vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
try { if (!self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = 1; } catch (e) { }

const MODELOS = { base: 'onnx-community/whisper-base', small: 'onnx-community/whisper-small' };
const OPC = { language: 'spanish', task: 'transcribe', max_new_tokens: 200 };
let asr = null, actual = '', dispositivo = '', cadena = Promise.resolve();

async function hayGPU() { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; } }

function crear(modelo, dev) {
  const arch = {}; let ult = 0;
  return pipeline('automatic-speech-recognition', MODELOS[modelo], {
    device: dev,
    // con GPU: codificador completo y decodificador comprimido; sin GPU: todo comprimido (más ligero para el procesador)
    dtype: dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: p => {
      if (p.status !== 'progress' || !p.file) return;
      arch[p.file] = p.loaded || 0;
      const ahora = Date.now(); if (ahora - ult < 250) return; ult = ahora;
      postMessage({ t: 'prog', loaded: Object.values(arch).reduce((a, b) => a + b, 0) });
    }
  });
}
async function soltar() { try { await asr?.dispose(); } catch (e) { } asr = null; actual = ''; }

async function cargar(modelo) {
  if (!MODELOS[modelo]) throw new Error('Modelo de voz desconocido: ' + modelo);
  if (asr && actual === modelo) return;
  await soltar();
  let dev = await hayGPU() ? 'webgpu' : 'wasm';
  const prepara = async d => { asr = await crear(modelo, d); await asr(new Float32Array(16000), OPC); };   // 1 s de silencio para dejar todo compilado
  try { await prepara(dev); }
  catch (e) {
    if (dev !== 'webgpu' || /fetch|network|load failed/i.test(String(e?.message || e))) throw e;      // sin red no tiene caso reintentar con el procesador
    console.warn('La GPU no pudo cargar el modelo; se usa el procesador.', e);
    await soltar(); dev = 'wasm'; await prepara(dev);
  }
  actual = modelo; dispositivo = dev;
}

async function atender(m) {
  try {
    if (m.t === 'cargar') { await cargar(m.modelo); postMessage({ t: 'listo', id: m.id, modelo: actual, dev: dispositivo }); }
    else if (m.t === 'tr') {
      if (!asr) throw new Error('El modelo de voz no está cargado');
      const t0 = performance.now(), r = await asr(m.audio, OPC);
      postMessage({ t: 'texto', id: m.id, texto: (Array.isArray(r) ? r[0]?.text : r?.text) || '', ms: performance.now() - t0 });
    }
    else if (m.t === 'soltar') { await soltar(); postMessage({ t: 'listo', id: m.id, modelo: '', dev: '' }); }
  } catch (err) { postMessage({ t: 'error', id: m.id, msg: String(err?.message || err).slice(0, 300) }); }
}
self.onmessage = e => { const m = e.data; cadena = cadena.then(() => atender(m)); };
