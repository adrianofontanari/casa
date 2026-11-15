/* Shared helpers for the integration tests (not a test file itself).
   nodeHttp() mirrors the plugin's http adapter (src/plugin/http.js) on top of node's fetch:
   resolves {status, headers, text, arrayBuffer, json}, rejects on network errors and timeouts. */
'use strict';

const fs = require('fs');
const path = require('path');

const LIVE = process.env.LIVE === '1';
const EVIDENCE = path.join(__dirname, '..', 'evidence');
const FIXTURES = path.join(__dirname, 'fixtures', 'integrations');

function nodeHttp(log) {
  return async function http(url, opts) {
    opts = opts || {};
    if (log) log.push(String(url));
    const res = await fetch(String(url), {
      method: opts.method || 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeout || 20000),
      headers: { 'user-agent': 'casa-obsidian-tests (https://github.com/adrianofontanari/casa)' },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder('utf-8').decode(buf);
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    let parsed, done = false;
    return {
      status: res.status, headers: headers, text: text, arrayBuffer: buf.buffer,
      get json() { if (!done) { done = true; try { parsed = JSON.parse(text); } catch (e) { parsed = null; } } return parsed; },
    };
  };
}

/* A fake http that answers from a table {url-prefix: response | (url) => response} and records calls. */
function fakeHttp(table) {
  const calls = [];
  const http = async (url, opts) => {
    calls.push(String(url));
    for (const k of Object.keys(table)) {
      if (String(url).indexOf(k) === 0) {
        let r = table[k];
        if (typeof r === 'function') r = await r(url, opts);
        if (r instanceof Error) throw r;
        return makeRes(r);
      }
    }
    throw new Error('getaddrinfo ENOTFOUND (fake) ' + url);
  };
  http.calls = calls;
  return http;
}

function makeRes(r) {
  const status = r.status || 200;
  let bytes;
  if (r.bytes) bytes = r.bytes;
  else if (r.json !== undefined) bytes = new TextEncoder().encode(JSON.stringify(r.json));
  else bytes = new TextEncoder().encode(r.text || '');
  const text = new TextDecoder().decode(bytes);
  let parsed, done = false;
  return {
    status: status, headers: r.headers || {}, text: text, arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    get json() { if (!done) { done = true; try { parsed = JSON.parse(text); } catch (e) { parsed = null; } } return parsed; },
  };
}

function ctx(settings, http, extra) {
  return Object.assign({ settings: settings || {}, http: http, cache: new Map() }, extra || {});
}

function fixture(name) { return fs.readFileSync(path.join(FIXTURES, name), 'utf8'); }

function saveEvidence(name, data) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const p = path.join(EVIDENCE, name);
  if (typeof data === 'string' || data instanceof Uint8Array) fs.writeFileSync(p, data);
  else fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return p;
}

module.exports = { LIVE, nodeHttp, fakeHttp, makeRes, ctx, fixture, saveEvidence, EVIDENCE, FIXTURES };
