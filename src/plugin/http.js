/* http(url, opts) for integration modules, backed by Obsidian's requestUrl (no CORS limits,
   no browser cookies). Resolves {status, headers, json, text, arrayBuffer}; `json` is the parsed
   body or null when the body is not JSON. Rejects only on network errors or timeout. */
function makeHttp(requestUrl, defaults) {
  defaults = defaults || {};
  const timeoutMs = defaults.timeout || 20000;
  return function http(url, opts) {
    opts = opts || {};
    const params = {
      url: String(url),
      method: opts.method || 'GET',
      headers: opts.headers || undefined,
      throw: false,
    };
    if (opts.body != null) {
      if (typeof opts.body === 'string' || opts.body instanceof ArrayBuffer) {
        params.body = opts.body;
        if (opts.contentType) params.contentType = opts.contentType;
      } else {
        params.body = JSON.stringify(opts.body);
        params.contentType = opts.contentType || 'application/json';
      }
    }
    const limit = opts.timeout || timeoutMs;
    let timer;
    const timeout = new Promise((_, reject) => {
      // no URL in the message: calendar and sensor links can carry secrets
      timer = setTimeout(() => reject(new Error('Request timed out after ' + limit + ' ms')), limit);
    });
    return Promise.race([requestUrl(params), timeout]).then((res) => {
      clearTimeout(timer);
      let parsed;
      let parsedDone = false;
      return {
        status: res.status,
        headers: res.headers || {},
        get text() { return res.text; },
        get arrayBuffer() { return res.arrayBuffer; },
        get json() {
          if (!parsedDone) {
            parsedDone = true;
            try { parsed = JSON.parse(res.text); } catch (e) { parsed = null; }
          }
          return parsed;
        },
      };
    }, (e) => {
      clearTimeout(timer);
      throw e;
    });
  };
}

module.exports = { makeHttp };
