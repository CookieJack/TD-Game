/* ============ Web Audio 合成音效（无音频文件） ============ */
const AudioSys = {
  ctx: null, master: null, muted: false,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* 无音频环境时静默降级 */ }
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  },

  // 基础音：freq0→freq1 扫频
  tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  // 噪声脉冲（打击感）
  noise(dur = 0.1, vol = 0.15, freq = 1200, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  },

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'shoot_frost':  this.tone(820, 320, 0.12, 'sine', 0.14); this.tone(1640, 640, 0.08, 'sine', 0.05); break;
      case 'shoot_arrow':  this.noise(0.05, 0.1, 3600); this.tone(1300, 900, 0.05, 'triangle', 0.06); break;
      case 'shoot_shadow': this.tone(240, 90, 0.22, 'sawtooth', 0.1); this.tone(480, 180, 0.15, 'sine', 0.06); break;
      case 'consecrate':   this.tone(160, 60, 0.25, 'sine', 0.22); this.noise(0.12, 0.12, 900); this.tone(720, 540, 0.2, 'sine', 0.06, 0.02); break;
      case 'hit':          this.noise(0.06, 0.09, 1800); break;
      case 'coin':         this.tone(980, 980, 0.07, 'square', 0.07); this.tone(1470, 1470, 0.12, 'square', 0.07, 0.07); break;
      case 'build':        this.tone(330, 330, 0.1, 'triangle', 0.14); this.tone(494, 494, 0.12, 'triangle', 0.14, 0.09); this.tone(659, 659, 0.18, 'triangle', 0.14, 0.18); break;
      case 'upgrade':      this.tone(440, 440, 0.08, 'square', 0.09); this.tone(554, 554, 0.08, 'square', 0.09, 0.07); this.tone(659, 659, 0.08, 'square', 0.09, 0.14); this.tone(880, 880, 0.2, 'square', 0.1, 0.21); break;
      case 'sell':         this.tone(880, 880, 0.07, 'square', 0.07); this.tone(587, 587, 0.12, 'square', 0.07, 0.07); break;
      case 'horn':         this.tone(174, 174, 0.55, 'sawtooth', 0.14); this.tone(261, 261, 0.55, 'sawtooth', 0.1, 0.02); this.tone(174 * 2, 174 * 2, 0.4, 'sine', 0.05, 0.05); break;
      case 'boss_horn':    this.tone(87, 82, 0.9, 'sawtooth', 0.22); this.tone(130, 123, 0.9, 'sawtooth', 0.14, 0.02); this.noise(0.5, 0.06, 400); break;
      case 'death':        this.tone(300, 60, 0.25, 'sawtooth', 0.08); this.noise(0.15, 0.06, 700); break;
      case 'leak':         this.tone(220, 110, 0.4, 'square', 0.16); this.noise(0.3, 0.1, 500); break;
      case 'error':        this.tone(140, 110, 0.15, 'square', 0.1); break;
      case 'stun':         this.tone(1200, 1200, 0.06, 'sine', 0.05); this.tone(1600, 1600, 0.06, 'sine', 0.05, 0.06); break;
      case 'victory':      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.28, 'triangle', 0.13, i * 0.16)); break;
      case 'defeat':       [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.34, 'sawtooth', 0.11, i * 0.22)); break;
    }
  }
};
