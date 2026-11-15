/* Ambient sounds for the headphones: sea, rain, fire and birds, synthesised with WebAudio.
   No sound files and no network.

   Each sound is rendered once, on first use, into a short mono buffer (24 kHz) whose ends are
   cross-faded so it loops without a click, then played by a looping AudioBufferSourceNode.
   After rendering, playback costs the browser's audio thread only: no timers, no
   ScriptProcessor, no animation frames. Every start, stop and volume change is a short ramp.
   When nothing plays, and while the room is paused (casa:pause), the AudioContext is
   suspended so the audio thread sleeps.

   API: window.CasaAmbient = { names, play(name), stop(), volume(v 0..1), playing(), state() }.
   CasaAmbient.render(name) returns the raw Float32Array (used by the unit tests). */
(function () {
  'use strict';

  const NAMES = ['sea', 'rain', 'fire', 'birds'];
  const SR = 24000;
  const FADE = 0.35;              // seconds, time constant of fades
  const XF = 0.6;                 // seconds of loop cross-fade
  const LENGTH = { sea: 22, rain: 9, fire: 11, birds: 17 };

  // ---------------------------------------------------------------- rendering (pure)

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pinkSource(r) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    return function () {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return p * 0.11;
    };
  }

  function brownSource(r) {
    let b = 0;
    return function () { b = (b + 0.02 * (r() * 2 - 1)) / 1.02; return b * 3.5; };
  }

  const coef = (fc) => 1 - Math.exp(-2 * Math.PI * fc / SR);

  /* A periodic envelope made of wave-shaped bumps, wrapped around the loop length. */
  function bumps(events, n) {
    const env = new Float32Array(n);
    for (const e of events) {
      const a = Math.round(e.at * SR), rise = Math.round(e.rise * SR), fall = Math.round(e.fall * SR);
      for (let i = 0; i < rise + fall; i++) {
        let v;
        if (i < rise) { const x = i / rise; v = x * x * (3 - 2 * x); }
        else { const x = (i - rise) / fall; v = Math.exp(-3.2 * x) * (1 - x * 0.2); }
        const k = ((a + i) % n + n) % n;
        env[k] = Math.max(env[k], v * e.amp);
      }
    }
    return env;
  }

  function sea(n, r) {
    const out = new Float32Array(n);
    const len = n / SR;
    const events = [];
    for (let t = 0.5; t < len - 0.5;) {
      const rise = 2.2 + r() * 1.6, fall = 3.4 + r() * 2.2;
      events.push({ at: t, rise: rise, fall: fall, amp: 0.55 + r() * 0.45 });
      t += rise + fall * (0.55 + r() * 0.25);
    }
    const env = bumps(events, n);
    const brown = brownSource(r), white = () => r() * 2 - 1;
    let lp = 0, lp2 = 0, foamLp = 0, envS = 0;
    for (let i = 0; i < n; i++) {
      envS += (env[i] - envS) * 0.0008;              // smooth the envelope a little more
      const e = envS;
      const fc = 180 + 2200 * e * e;
      const c = coef(fc);
      lp += c * (brown() - lp);
      lp2 += c * (lp - lp2);
      const w = white();
      foamLp += coef(5000) * (w - foamLp);
      out[i] = lp2 * (0.18 + 0.82 * e) + foamLp * 0.22 * Math.pow(e, 3);
    }
    return out;
  }

  function rain(n, r) {
    const out = new Float32Array(n);
    const pink = pinkSource(r);
    let lo = 0, hi = 0;
    for (let i = 0; i < n; i++) {
      const p = pink();
      lo += coef(7000) * (p - lo);
      hi += coef(500) * (lo - hi);
      out[i] = (lo - hi) * 0.55;
    }
    // drops: short decaying tones, a few louder "plinks"
    const drops = Math.round((n / SR) * 55);
    for (let d = 0; d < drops; d++) {
      const at = Math.floor(r() * n);
      const big = r() < 0.06;
      const f = big ? 900 + r() * 1400 : 2200 + r() * 3000;
      const dur = Math.round((big ? 0.035 : 0.008 + r() * 0.01) * SR);
      const amp = big ? 0.12 + r() * 0.1 : 0.03 + r() * 0.05;
      let ph = r() * Math.PI * 2;
      for (let i = 0; i < dur; i++) {
        const k = (at + i) % n;
        const env = Math.exp(-5 * i / dur) * Math.min(1, i / 12);
        ph += 2 * Math.PI * f * (1 - 0.25 * i / dur) / SR;
        out[k] += Math.sin(ph) * env * amp;
      }
    }
    return out;
  }

  function fire(n, r) {
    const out = new Float32Array(n);
    const brown = brownSource(r), pink = pinkSource(r);
    let lp = 0, flick = 0.6, target = 0.6, hissLp = 0, hissHp = 0;
    for (let i = 0; i < n; i++) {
      if (i % 2400 === 0) target = 0.45 + r() * 0.55;
      flick += (target - flick) * 0.00025;
      lp += coef(320) * (brown() - lp);
      const p = pink();
      hissLp += coef(6000) * (p - hissLp);
      hissHp += coef(2500) * (hissLp - hissHp);
      out[i] = lp * 0.9 * flick + (hissLp - hissHp) * 0.05 * flick;
    }
    // crackles: clusters of tiny noise snaps
    const t = n / SR;
    for (let c = 0; c < t * 7; c++) {
      const at = Math.floor(r() * n);
      const count = 1 + Math.floor(r() * (r() < 0.2 ? 6 : 2));
      for (let j = 0; j < count; j++) {
        const start = at + Math.floor(r() * 0.12 * SR);
        const dur = Math.round((0.0015 + r() * 0.006) * SR);
        const amp = 0.15 + r() * 0.45;
        let prev = 0;
        for (let i = 0; i < dur; i++) {
          const k = (start + i) % n;
          const w = r() * 2 - 1;
          const hp = w - prev; prev = w;
          out[k] += hp * amp * Math.exp(-6 * i / dur);
        }
      }
    }
    return out;
  }

  function birds(n, r) {
    const out = new Float32Array(n);
    const pink = pinkSource(r);
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += coef(900) * (pink() - lp); out[i] = lp * 0.12; }
    function note(at, dur, f0, f1, amp, vib) {
      const a = Math.floor(at * SR), len = Math.floor(dur * SR);
      let ph = 0;
      for (let i = 0; i < len && a + i < n; i++) {
        const x = i / len;
        const f = f0 + (f1 - f0) * x + (vib ? Math.sin(i / SR * 2 * Math.PI * 28) * vib : 0);
        ph += 2 * Math.PI * f / SR;
        const env = Math.pow(Math.sin(Math.PI * x), 2);
        out[a + i] += (Math.sin(ph) + 0.12 * Math.sin(2 * ph)) * env * amp;
      }
    }
    const len = n / SR;
    for (let t = 0.6; t < len - 2;) {
      const kind = r();
      const amp = 0.05 + r() * 0.07;
      if (kind < 0.4) {                    // a run of falling chirps
        const k = 3 + Math.floor(r() * 4), base = 3600 + r() * 1400;
        for (let j = 0; j < k; j++) note(t + j * 0.11, 0.07, base, base - 1500 - r() * 400, amp, 0);
        t += k * 0.11;
      } else if (kind < 0.7) {             // a trill
        const k = 8 + Math.floor(r() * 8), f = 3000 + r() * 900;
        for (let j = 0; j < k; j++) note(t + j * 0.045, 0.04, j % 2 ? f : f * 1.15, j % 2 ? f * 1.05 : f * 1.1, amp * 0.8, 0);
        t += k * 0.045;
      } else {                             // a two-note whistle
        const f = 2100 + r() * 800;
        note(t, 0.32, f, f * 1.45, amp, 40);
        note(t + 0.4, 0.25, f * 1.3, f * 1.1, amp * 0.8, 30);
        t += 0.65;
      }
      t += 0.5 + r() * 1.8;
    }
    return out;
  }

  const MAKERS = { sea: sea, rain: rain, fire: fire, birds: birds };

  /* Render name -> Float32Array of LENGTH[name] seconds that loops seamlessly. */
  function render(name) {
    const make = MAKERS[name];
    if (!make) throw new Error('Unknown ambient sound: ' + name);
    const n = Math.round(LENGTH[name] * SR);
    const x = Math.round(XF * SR);
    const raw = make(n + x, rng(1000 + NAMES.indexOf(name)));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = raw[i];
    for (let i = 0; i < x; i++) {             // equal-power cross-fade of the tail into the head
      const g = i / x;
      out[i] = raw[i] * Math.sin(g * Math.PI / 2) + raw[n + i] * Math.cos(g * Math.PI / 2);
    }
    let sum = 0, peak = 0;
    for (let i = 0; i < n; i++) { sum += out[i] * out[i]; peak = Math.max(peak, Math.abs(out[i])); }
    const rms = Math.sqrt(sum / n) || 1;
    const gain = Math.min(0.16 / rms, 0.92 / (peak || 1));
    for (let i = 0; i < n; i++) out[i] *= gain;
    return out;
  }

  // ---------------------------------------------------------------- playback

  let ac = null, master = null, cur = null, vol = 0.6, pausedByRoom = false, suspendTimer = null;
  const buffers = {};

  function context() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC({ latencyHint: 'playback' });
    master = ac.createGain();
    master.gain.value = vol * vol;
    master.connect(ac.destination);
    return ac;
  }

  function bufferFor(name) {
    if (!buffers[name]) {
      const data = render(name);
      const b = ac.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      buffers[name] = b;
    }
    return buffers[name];
  }

  function fadeOut(node) {
    const t = ac.currentTime;
    node.gain.gain.cancelScheduledValues(t);
    node.gain.gain.setValueAtTime(node.gain.gain.value, t);
    node.gain.gain.setTargetAtTime(0, t, FADE / 2);
    try { node.src.stop(t + FADE * 4); } catch (e) { /* already stopped */ }
  }

  function play(name) {
    if (NAMES.indexOf(name) === -1) return false;
    if (!context()) return false;
    if (cur && cur.name === name) return true;
    clearTimeout(suspendTimer);
    const src = ac.createBufferSource();
    src.buffer = bufferFor(name);
    src.loop = true;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(g).connect(master);
    const t = ac.currentTime;
    src.start(t, Math.random() * src.buffer.duration * 0.8);
    g.gain.setTargetAtTime(1, t, FADE);
    if (cur) fadeOut(cur);
    cur = { name: name, src: src, gain: g };
    if (!pausedByRoom && ac.state !== 'running') ac.resume();
    return true;
  }

  function stop() {
    if (!ac || !cur) return;
    fadeOut(cur);
    cur = null;
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => { if (!cur && ac.state === 'running') ac.suspend(); }, FADE * 5 * 1000);
  }

  function volume(v) {
    const x = Math.max(0, Math.min(1, Number(v)));
    if (!Number.isFinite(x)) return vol;
    vol = x;
    if (ac) master.gain.setTargetAtTime(vol * vol, ac.currentTime, 0.08);
    return vol;
  }

  document.addEventListener('casa:pause', () => {
    pausedByRoom = true;
    if (ac && ac.state === 'running') ac.suspend();
  });
  document.addEventListener('casa:resume', () => {
    pausedByRoom = false;
    if (ac && cur && ac.state !== 'running') ac.resume();
  });

  window.CasaAmbient = {
    names: NAMES.slice(),
    play: play,
    stop: stop,
    volume: volume,
    playing: () => (cur ? cur.name : null),
    state: () => (ac ? ac.state : 'none'),
    render: render,
    sampleRate: SR,
  };
})();
