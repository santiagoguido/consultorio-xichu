// Captura el audio del micrófono en bloques y lo entrega a la app. No guarda nada.
class VivoCap extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.b[this.n++] = ch[i];
        if (this.n === 4096) { this.port.postMessage(this.b.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('vivo-cap', VivoCap);
