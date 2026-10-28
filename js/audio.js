// Motor y viento sintetizados con WebAudio, sin archivos externos.
export class EngineAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engineGain = null;
    this.windGain = null;
    this.engineFilter = null;
    this.oscillators = [];
    this.muted = false;
    this.started = false;
  }

  init() {
    if (this.started) {
      this.context?.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.context.destination);

      this.engineFilter = this.context.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineFilter.Q.value = 2.5;
      this.engineFilter.connect(this.master);

      this.engineGain = this.context.createGain();
      this.engineGain.gain.value = 0;
      this.engineGain.connect(this.engineFilter);

      const base = this.context.createOscillator();
      base.type = 'sawtooth';
      base.frequency.value = 48;
      base.connect(this.engineGain);

      const harmonic = this.context.createOscillator();
      harmonic.type = 'square';
      harmonic.frequency.value = 96;
      const harmonicGain = this.context.createGain();
      harmonicGain.gain.value = 0.35;
      harmonic.connect(harmonicGain);
      harmonicGain.connect(this.engineGain);

      this.oscillators = [base, harmonic];
      base.start();
      harmonic.start();

      // Viento: ruido blanco filtrado.
      const duration = 2;
      const buffer = this.context.createBuffer(1, this.context.sampleRate * duration, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.94 + white * 0.06;
        data[i] = last * 3.2;
      }
      const noise = this.context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const windFilter = this.context.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 750;
      windFilter.Q.value = 0.65;
      this.windGain = this.context.createGain();
      this.windGain.gain.value = 0;
      noise.connect(windFilter);
      windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      noise.start();

      this.started = true;
    } catch {
      this.started = false;
    }
  }

  update(speed, throttle, active) {
    if (!this.started || !this.context) return;
    const now = this.context.currentTime;
    const speedNorm = Math.min(speed / 130, 1);
    const targetEngine = active ? 0.035 + throttle * 0.07 : 0.012;
    this.engineGain.gain.setTargetAtTime(targetEngine, now, 0.15);
    this.windGain.gain.setTargetAtTime(active ? 0.012 + speedNorm * 0.05 : 0.005, now, 0.2);
    const frequency = 38 + throttle * 52 + speedNorm * 18;
    this.oscillators[0].frequency.setTargetAtTime(frequency, now, 0.2);
    this.oscillators[1].frequency.setTargetAtTime(frequency * 2.02, now, 0.2);
    this.engineFilter.frequency.setTargetAtTime(260 + throttle * 720 + speedNorm * 260, now, 0.2);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.context.currentTime, 0.05);
  }

  crash() {
    if (!this.started || !this.context || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(120, now);
    oscillator.frequency.exponentialRampToValueAtTime(28, now + 0.8);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 1.2);
  }
}
