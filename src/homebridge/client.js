// -----------------------------------------------------------------------------
// The REST API of the Homebridge UI (homebridge-config-ui-x 5.x), with the
// fetch and WebSocket of Node 22.
//
//   POST /api/auth/login             { username, password } -> { access_token, expires_in }
//   POST /api/auth/noauth            a token when the UI runs without login
//   GET  /api/accessories            every HAP service of every bridge, with its values
//   PUT  /api/accessories/{uniqueId} { characteristicType, value }
//   GET  /api/status/homebridge-version
//   Socket.IO namespace /accessories "get-accessories" -> "accessories-data"
//                                    events: the whole list, then each change
//
// The accessories need Homebridge in insecure mode (-I): without it, the list
// is a 400 "must be running in insecure mode". Verified against Homebridge
// 2.4.0 and UI 5.29.0 in Docker: wrong credentials are a 403, a wrong or
// expired token a 401, an unknown uniqueId a 400 with { message }.
//
// Socket.IO is spoken by hand over the WebSocket transport (Engine.IO 4): a
// handful of text frames, no dependency for it.
// -----------------------------------------------------------------------------

export const CLIENT_TIMINGS = { requestTimeout: 15_000 };

/** The token is renewed at this share of its lifetime (8 h by default). */
const RENEW_AT = 0.8;

/** Homebridge refused the credentials or the token (401, 403). */
export class HbAuthError extends Error {
  constructor(status, detail = '') {
    super(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
    this.name = 'HbAuthError';
    this.status = status;
  }
}

/** Homebridge runs without insecure mode: the accessories cannot be read. */
export class HbInsecureError extends Error {
  constructor() {
    super('Homebridge is not in insecure mode');
    this.name = 'HbInsecureError';
  }
}

/** Homebridge answered with an error status. */
export class HbHttpError extends Error {
  constructor(status, detail) {
    super(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
    this.name = 'HbHttpError';
    this.status = status;
    this.detail = detail;
  }
}

const reasonOf = (err) => {
  // undici hides the reason (ECONNREFUSED, ENOTFOUND...) in `cause`.
  if (err?.name === 'TimeoutError') {
    return 'timeout';
  }
  return err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err);
};

export class HomebridgeClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl normalized by src/config.js (no /api)
   * @param {string} [options.username] empty: the UI runs without login
   * @param {string} [options.password]
   * @param {typeof fetch} [options.fetch]
   * @param {typeof WebSocket} [options.WebSocket]
   * @param {() => number} [options.now]
   * @param {object} [options.timings]
   */
  constructor({
    baseUrl,
    username,
    password,
    fetch = globalThis.fetch,
    WebSocket = globalThis.WebSocket,
    now = Date.now,
    timings,
  }) {
    this.baseUrl = baseUrl;
    this.username = username ?? '';
    this.password = password ?? '';
    this.fetch = fetch;
    this.WebSocket = WebSocket;
    this.now = now;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.token = undefined;
    this.renewAt = 0;
  }

  async raw(method, path, { body, token } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timings.requestTimeout),
        redirect: 'error',
      });
    } catch (err) {
      throw new Error(reasonOf(err), { cause: err });
    }
    const text = await response.text();
    let json = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      // Not JSON: a proxy page, or the status alone.
    }
    if (!response.ok) {
      const detail = String(json?.message ?? '').slice(0, 200);
      if (response.status === 401 || response.status === 403) {
        throw new HbAuthError(response.status, detail);
      }
      if (/insecure mode/i.test(detail)) {
        throw new HbInsecureError();
      }
      throw new HbHttpError(response.status, detail);
    }
    return json;
  }

  /** Logs in (or asks for the token of a UI without login). Never logged. */
  async login() {
    const answer = this.username
      ? await this.raw('POST', '/api/auth/login', {
          body: { username: this.username, password: this.password },
        })
      : await this.raw('POST', '/api/auth/noauth');
    if (typeof answer?.access_token !== 'string' || answer.access_token === '') {
      throw new Error('no token in the login answer');
    }
    this.token = answer.access_token;
    const lifetime = Number(answer.expires_in);
    this.renewAt =
      this.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000 * RENEW_AT;
    return this.token;
  }

  async validToken() {
    if (!this.token || this.now() >= this.renewAt) {
      await this.login();
    }
    return this.token;
  }

  /** An authenticated request; a token refused on the way is renewed once. */
  async request(method, path, options = {}) {
    const token = await this.validToken();
    try {
      return await this.raw(method, path, { ...options, token });
    } catch (err) {
      if (err instanceof HbAuthError && err.status === 401) {
        this.token = undefined;
        return this.raw(method, path, { ...options, token: await this.validToken() });
      }
      throw err;
    }
  }

  /** Every HAP service of every bridge, with its characteristics and values. */
  async getAccessories() {
    const services = await this.request('GET', '/api/accessories');
    if (!Array.isArray(services)) {
      throw new Error('unexpected answer to /api/accessories');
    }
    return services;
  }

  async setCharacteristic(uniqueId, characteristicType, value) {
    return this.request('PUT', `/api/accessories/${encodeURIComponent(uniqueId)}`, {
      body: { characteristicType, value },
    });
  }

  /** The Homebridge version, or '' (not worth a failure). */
  async getVersion() {
    try {
      const info = await this.request('GET', '/api/status/homebridge-version');
      return String(info?.installedVersion ?? '');
    } catch {
      return '';
    }
  }

  /**
   * Opens the Socket.IO namespace /accessories. Resolves once the UI accepted
   * it, with `{ close, done }`: `done` settles when the socket ends.
   * `onEvent({ type: 'data', services })` for each "accessories-data",
   * `onEvent({ type: 'ping' })` for the keep-alives (every 25 s).
   * @param {(event: object) => void} onEvent
   */
  async openEvents(onEvent) {
    const token = await this.validToken();
    const url = `${this.baseUrl.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
    const NS = '/accessories';
    let ws;
    try {
      ws = new this.WebSocket(url);
    } catch (err) {
      throw new Error(reasonOf(err), { cause: err });
    }
    let settle;
    const done = new Promise((resolve) => {
      settle = resolve;
    });
    return new Promise((resolve, reject) => {
      let opened = false;
      const fail = (err) => {
        clearTimeout(timer);
        if (!opened) {
          opened = true;
          reject(err);
        }
        try {
          ws.close();
        } catch {
          // Already closed.
        }
      };
      const timer = setTimeout(() => fail(new Error('timeout')), this.timings.requestTimeout);
      ws.onerror = (event) => fail(new Error(reasonOf(event?.error ?? event)));
      ws.onclose = () => {
        fail(new Error('socket closed'));
        settle();
      };
      ws.onmessage = (event) => {
        const frame = String(event.data);
        if (frame === '2') {
          ws.send('3');
          onEvent({ type: 'ping' });
          return;
        }
        if (frame.startsWith('0{')) {
          ws.send(`40${NS},${JSON.stringify({ token })}`);
          return;
        }
        if (frame.startsWith(`40${NS}`)) {
          ws.send(`42${NS},["get-accessories"]`);
          clearTimeout(timer);
          opened = true;
          resolve({ close: () => ws.close(), done });
          return;
        }
        if (frame.startsWith(`44${NS}`)) {
          fail(new HbAuthError(401, 'socket refused'));
          return;
        }
        if (frame.startsWith(`41${NS}`)) {
          ws.close();
          return;
        }
        if (frame.startsWith(`42${NS},`)) {
          let message;
          try {
            message = JSON.parse(frame.slice(NS.length + 3));
          } catch {
            return;
          }
          if (message?.[0] === 'accessories-data' && Array.isArray(message[1])) {
            onEvent({ type: 'data', services: message[1] });
          }
        }
      };
    });
  }
}
