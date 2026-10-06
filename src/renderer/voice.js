'use strict';
// Microphone capture with phrase-by-phrase segmentation.
//
// While recording, a simple voice-activity detector watches the input level.
// When the speaker pauses, the current segment is closed and handed off for
// transcription while recording continues, so text appears as you talk.
// Segments that contain no speech are dropped (transcription models tend to
// invent words for silence).

window.Voice = (() => {
  const MAX_MS = 15 * 60 * 1000;   // whole session cap
  const TICK_MS = 50;
  // Speech/silence thresholds adapt to the room: they sit a margin above the
  // measured noise floor, so quiet microphones and noisy rooms both work.
  const MIN_SPEECH_LEVEL = 0.025;
  const MIN_SILENCE_LEVEL = 0.015;
  const PAUSE_MS = 700;            // pause long enough to close a phrase
  const MIN_SEGMENT_MS = 1500;
  const MIN_SPEECH_MS = 250;       // per segment, to be worth sending
  const MIN_FINAL_SPEECH_MS = 120; // the last segment may be a single short word
  const MIN_FIRST_MS = 600;        // a whole session this long is always sent, whatever the meter says
  const SOFT_MAX_MS = 20000;       // after this, cut at the next small dip
  const HARD_MAX_MS = 45000;

  const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const MAC = window.recaller?.platform === 'darwin'; // the Mac edition points to macOS's own settings

  class VoiceError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  let active = null;

  class Recording {
    constructor({ onLevel, onSegment, onAutoStop }) {
      this.onLevel = onLevel;
      this.onSegment = onSegment;
      this.onAutoStop = onAutoStop;
      this.startedAt = 0;
      this.cancelled = false;
      this.meterOk = false;
      this.chain = Promise.resolve(); // keeps segments in spoken order
      this.emitted = 0;
    }

    async start() {
      if (!window.MediaRecorder) throw new VoiceError('UNSUPPORTED', 'Recording is not supported here.');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          throw new VoiceError('DENIED', MAC
            ? 'Microphone blocked. In System Settings › Privacy & Security › Microphone, turn Recaller on (or off and on again after an update), then try again.'
            : 'Microphone blocked. Allow it in Windows Settings › Privacy & security › Microphone.');
        }
        if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') throw new VoiceError('NO_MIC', 'No microphone found.');
        if (err.name === 'NotReadableError') throw new VoiceError('BUSY', 'The microphone is in use by another app.');
        throw new VoiceError('MIC', err.message || 'Could not start the microphone.');
      }
      if (this.cancelled) return this.release();
      this.startedAt = performance.now();
      this.segment = this.openSegment();
      this.startMeter();
      this.limitTimer = setTimeout(() => this.onAutoStop?.(), MAX_MS);
    }

    openSegment() {
      const recorder = new MediaRecorder(this.stream, MIME ? { mimeType: MIME, audioBitsPerSecond: 48000 } : undefined);
      const seg = { recorder, chunks: [], startedAt: performance.now(), speechMs: 0, silentMs: 0 };
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) seg.chunks.push(e.data); };
      seg.stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start(500);
      return seg;
    }

    // Close the current segment and immediately start the next one (they overlap
    // by a few ms, so no audio is lost at the boundary).
    cut() {
      const old = this.segment;
      this.segment = this.openSegment();
      this.finishSegment(old, MIN_SPEECH_MS);
    }

    finishSegment(seg, minSpeech, { final = false } = {}) {
      if (seg.recorder.state !== 'inactive') seg.recorder.stop();
      const duration = performance.now() - seg.startedAt;
      this.chain = this.chain.then(() => seg.stopped).then(() => {
        // Never throw away the only recording of a session: if the meter heard
        // nothing, trust the user who pressed the mic over the level meter.
        const onlyTake = final && this.emitted === 0 && duration >= MIN_FIRST_MS;
        const hasSpeech = !this.meterOk || seg.speechMs >= minSpeech || onlyTake;
        if (this.cancelled || !hasSpeech || !seg.chunks.length) return;
        const type = seg.recorder.mimeType || MIME || 'audio/webm';
        this.emitted++;
        this.onSegment?.({ blob: new Blob(seg.chunks, { type }), mime: type, duration: performance.now() - seg.startedAt });
      });
    }

    startMeter() {
      try {
        this.audioCtx = new AudioContext();
        const source = this.audioCtx.createMediaStreamSource(this.stream);
        const analyser = this.audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let smooth = 0;
        let floor = 0.02;
        this.meterOk = true;
        this.meterTimer = setInterval(() => {
          const seg = this.segment;
          if (!seg) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const level = Math.min(1, Math.sqrt(sum / buf.length) * 7);
          smooth = level > smooth ? level : smooth * 0.8 + level * 0.2;
          this.onLevel?.(smooth);

          // Noise floor: follows quiet moments down at once, creeps up slowly.
          floor = level < floor ? level : Math.min(0.2, floor * 1.003 + 0.00002);
          const speechLevel = Math.max(MIN_SPEECH_LEVEL, floor * 2.5 + 0.012);
          const silenceLevel = Math.max(MIN_SILENCE_LEVEL, floor * 1.6 + 0.006);
          if (level > speechLevel) { seg.speechMs += TICK_MS; seg.silentMs = 0; }
          else if (level < silenceLevel) seg.silentMs += TICK_MS;

          const age = performance.now() - seg.startedAt;
          const pause = seg.silentMs >= PAUSE_MS && seg.speechMs >= MIN_SPEECH_MS && age >= MIN_SEGMENT_MS;
          const tooLong = (age >= SOFT_MAX_MS && seg.silentMs >= 150) || age >= HARD_MAX_MS;
          if (pause || tooLong) this.cut();
        }, TICK_MS);
      } catch {
        this.meterOk = false; // no level meter: record one segment, send it all
      }
    }

    elapsed() {
      return this.startedAt ? performance.now() - this.startedAt : 0;
    }

    // Resolves with the number of segments handed off during the whole session.
    async stop() {
      clearInterval(this.meterTimer);
      const seg = this.segment;
      this.segment = null;
      if (seg) this.finishSegment(seg, MIN_FINAL_SPEECH_MS, { final: true });
      await this.chain;
      this.release();
      return this.emitted;
    }

    cancel() {
      this.cancelled = true;
      clearInterval(this.meterTimer);
      try { if (this.segment && this.segment.recorder.state !== 'inactive') this.segment.recorder.stop(); } catch {}
      this.segment = null;
      this.release();
    }

    release() {
      clearTimeout(this.limitTimer);
      clearInterval(this.meterTimer);
      this.stream?.getTracks().forEach((t) => t.stop());
      this.audioCtx?.close().catch(() => {});
      this.audioCtx = null;
      if (active === this) active = null;
    }
  }

  async function start(opts) {
    if (active) active.cancel();
    const rec = new Recording(opts);
    active = rec;
    await rec.start();
    return rec;
  }

  /** Transcribes one segment. `onDelta` gets streamed fragments; `onReset` clears them before a retry. */
  async function transcribe(audio, { context = '', onDelta, onReset } = {}) {
    const bytes = new Uint8Array(await audio.blob.arrayBuffer());
    const res = await window.recaller.transcribe(bytes, audio.mime, context, (msg) => {
      if (msg.type === 'delta') onDelta?.(msg.delta);
      else if (msg.type === 'reset') onReset?.();
    });
    if (!res.ok) throw new VoiceError(res.code, res.error);
    return res.text;
  }

  return { start, transcribe, VoiceError, isActive: () => Boolean(active) };
})();
