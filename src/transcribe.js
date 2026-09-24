'use strict';
// OpenAI speech-to-text. Runs in the main process so the API key never
// reaches the renderer. Streams partial text when the model supports it.

const API_BASE = (process.env.RECALLER_OPENAI_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const TIMEOUT_MS = 90_000;

// gpt-transcribe takes a `languages` array; older models take a single `language`.
const USES_LANGUAGE_ARRAY = new Set(['gpt-transcribe']);
// whisper-1 can't stream completed files.
const STREAMABLE = new Set(['gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe']);

class TranscribeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function extensionFor(mime) {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

function buildForm(bytes, mime, { model, language, prompt, stream }) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime.split(';')[0] || 'audio/webm' }), `speech.${extensionFor(mime)}`);
  form.append('model', model);
  if (language) {
    if (USES_LANGUAGE_ARRAY.has(model)) form.append('languages[]', language);
    else form.append('language', language);
  }
  if (prompt) form.append('prompt', prompt);
  if (stream) form.append('stream', 'true');
  return form;
}

async function readError(res) {
  try {
    const body = await res.json();
    return body?.error?.message || JSON.stringify(body);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

// Parses the server-sent events of a streamed transcription.
async function readStream(res, onDelta) {
  const decoder = new TextDecoder();
  let buffer = '';
  let partial = '';
  let final = null;
  const handle = (block) => {
    const payload = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!payload || payload === '[DONE]') return;
    let event;
    try { event = JSON.parse(payload); } catch { return; }
    if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') {
      partial += event.delta;
      onDelta(event.delta);
    } else if (event.type === 'transcript.text.done' && typeof event.text === 'string') {
      final = event.text;
    } else if (event.type === 'error' || event.error) {
      throw new TranscribeError('STREAM', event.error?.message || 'Transcription failed mid-way.');
    }
  };
  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
      }
    }
    if (buffer.trim()) handle(buffer);
  } catch (err) {
    if (err instanceof TranscribeError) throw err;
    if (err.name === 'TimeoutError') throw new TranscribeError('TIMEOUT', 'Transcription timed out. Try again.');
    throw new TranscribeError('STREAM', 'The connection dropped while transcribing.');
  }
  return (final ?? partial).trim();
}

async function request(apiKey, bytes, mime, opts, events = {}) {
  const stream = Boolean(events.onDelta) && STREAMABLE.has(opts.model);
  let res;
  try {
    res = await fetch(`${API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildForm(bytes, mime, { ...opts, stream }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new TranscribeError('TIMEOUT', 'Transcription timed out. Try again.');
    throw new TranscribeError('NETWORK', "Couldn't reach OpenAI. Check your internet connection.");
  }

  if (res.ok) {
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) return readStream(res, events.onDelta);
    const body = await res.json();
    return String(body.text ?? '').trim();
  }

  const detail = await readError(res);
  if (res.status === 401) throw new TranscribeError('AUTH', 'OpenAI rejected the API key. Update it in Settings.');
  if (res.status === 429) throw new TranscribeError('RATE', `OpenAI rate limit or quota reached. ${detail}`);
  if (res.status === 400) throw new TranscribeError('BAD_REQUEST', detail);
  if (res.status >= 500) throw new TranscribeError('SERVER', `OpenAI had a problem (${res.status}). Try again.`);
  throw new TranscribeError('HTTP', `${res.status}: ${detail}`);
}

/**
 * @param events.onDelta  called with each streamed text fragment
 * @param events.onReset  called when streamed text so far must be discarded (before a retry)
 */
async function transcribe(apiKey, bytes, mime, { model, language, hint, context }, events = {}) {
  if (!apiKey) throw new TranscribeError('NO_KEY', 'Add your OpenAI API key in Settings to use voice.');
  // The prompt carries vocabulary hints plus the tail of what was said before,
  // so phrase-by-phrase segments read as one continuous text.
  const prompt = [hint, context ? String(context).slice(-400) : ''].filter(Boolean).join('\n');
  const opts = { model, language, prompt };
  try {
    const text = await request(apiKey, bytes, mime, opts, events);
    // An empty streamed result is suspicious (phrases are only sent when speech
    // was heard), so confirm once with a plain request before giving up.
    if (!text && events.onDelta && STREAMABLE.has(model)) return await request(apiKey, bytes, mime, opts);
    return text;
  } catch (err) {
    // One automatic retry for transient failures.
    if (['NETWORK', 'SERVER', 'STREAM'].includes(err.code)) {
      events.onReset?.();
      await new Promise((r) => setTimeout(r, 600));
      return request(apiKey, bytes, mime, opts, events);
    }
    // If an optional parameter was rejected, retry with just the audio, unstreamed.
    if (err.code === 'BAD_REQUEST') {
      events.onReset?.();
      return request(apiKey, bytes, mime, { model });
    }
    throw err;
  }
}

module.exports = { transcribe, TranscribeError };
