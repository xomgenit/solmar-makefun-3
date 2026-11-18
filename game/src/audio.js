// WebAudio-synthesised sound only: no audio files, no network. Everything
// is an oscillator/noise burst shaped in code.
export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
    this.sirenNodes = null; this.engineNodes = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.35; return this.muted; }
  tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, when = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur, vol = 0.2, freq = 1000) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }
  shot() { this.noise(0.09, 0.25, 2400); this.tone(180, 0.07, 'square', 0.12, 60); }
  crash() { this.noise(0.25, 0.3, 500); this.tone(70, 0.2, 'sine', 0.25, 35); }
  pickup() { this.tone(660, 0.1, 'sine', 0.2); this.tone(990, 0.14, 'sine', 0.2, null, 0.08); }
  jingle() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.18, null, i * 0.11)); }
  fail() { this.tone(220, 0.25, 'sawtooth', 0.15, 110); }
  click() { this.tone(900, 0.05, 'square', 0.08); }
  horn() { this.tone(370, 0.18, 'square', 0.12); this.tone(440, 0.18, 'square', 0.1); }
  siren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenNodes) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = 850;
      lfo.type = 'sine'; lfo.frequency.value = 0.7; lg.gain.value = 250;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.value = 0.05;
      o.connect(g); g.connect(this.master);
      o.start(); lfo.start();
      this.sirenNodes = { o, g, lfo };
    } else if (!on && this.sirenNodes) {
      try { this.sirenNodes.o.stop(); this.sirenNodes.lfo.stop(); } catch { /* already stopped */ }
      this.sirenNodes = null;
    }
  }
  engine(on, speed01 = 0) {
    if (!this.ctx) return;
    if (on && !this.engineNodes) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 60;
      g.gain.value = 0.04;
      o.connect(g); g.connect(this.master);
      o.start();
      this.engineNodes = { o, g };
    }
    if (this.engineNodes) {
      this.engineNodes.o.frequency.value = 55 + speed01 * 140;
      this.engineNodes.g.gain.value = on ? 0.03 + speed01 * 0.03 : 0;
    }
    if (!on && this.engineNodes) { try { this.engineNodes.o.stop(); } catch { /* noop */ } this.engineNodes = null; }
  }
}
