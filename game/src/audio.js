// Synthesized sound only: every effect is an oscillator or a noise buffer built in code,
// no audio files, no network. One shared AudioContext, one master gain, M mutes.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let lastStep = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(duration, filterFreq, gainValue, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  function tone(freq, duration, type, gainValue, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const SHOT_TONE = {
    pistol: () => { noise(0.09, 2400, 0.5); tone(180, 0.08, 'square', 0.25, 60); },
    smg: () => { noise(0.06, 3000, 0.35); tone(220, 0.05, 'square', 0.18, 80); },
    rifle: () => { noise(0.12, 1800, 0.6); tone(140, 0.11, 'square', 0.3, 50); },
    sniper: () => { noise(0.25, 1200, 0.8); tone(110, 0.22, 'sawtooth', 0.35, 40); },
    enemy: () => { noise(0.1, 1500, 0.25); tone(150, 0.09, 'square', 0.12, 55); },
  };

  return {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    shot(kind) { (SHOT_TONE[kind] ?? SHOT_TONE.rifle)(); },
    dryFire() { tone(900, 0.03, 'square', 0.12); },
    reload() { tone(500, 0.05, 'square', 0.15); tone(700, 0.05, 'square', 0.15, 0, 0.12); },
    hit() { tone(1200, 0.05, 'sine', 0.25); },
    kill() { tone(880, 0.07, 'sine', 0.3); tone(1320, 0.1, 'sine', 0.3, 0, 0.07); },
    hurt() { tone(200, 0.12, 'sawtooth', 0.2, 90); },
    step(now) {
      if (now - lastStep < 0.32) return;
      lastStep = now;
      noise(0.05, 700, 0.12);
    },
    plantBeep() { tone(1500, 0.08, 'sine', 0.25); },
    plantDone() { tone(1000, 0.1, 'sine', 0.3); tone(1500, 0.15, 'sine', 0.3, 0, 0.1); },
    defuseBeep() { tone(1100, 0.08, 'sine', 0.22); },
    explosion() {
      noise(0.9, 500, 1.0);
      tone(90, 0.8, 'sine', 0.6, 30);
    },
    grenadeThrow() { noise(0.15, 900, 0.2); },
    roundWin() {
      tone(523, 0.12, 'sine', 0.3); tone(659, 0.12, 'sine', 0.3, 0, 0.12);
      tone(784, 0.2, 'sine', 0.35, 0, 0.24);
    },
    roundLose() {
      tone(392, 0.15, 'sine', 0.3); tone(330, 0.15, 'sine', 0.3, 0, 0.15);
      tone(262, 0.3, 'sine', 0.3, 0, 0.3);
    },
    buy() { tone(700, 0.06, 'sine', 0.25); tone(1050, 0.08, 'sine', 0.25, 0, 0.06); },
    denied() { tone(220, 0.12, 'square', 0.2, 160); },
    click() { tone(800, 0.03, 'sine', 0.15); },
  };
}
