// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  include_accessories: '',
  exclude_accessories: '',
  allow_lock_commands: false,
  allow_garage_door_commands: false,
  allow_alarm_commands: false,
  sensor_interval: 10,
  language: 'fr',
};

// The Homebridge UI listens on 8581 by default: an address typed without a port gets it.
export const DEFAULT_PORT = 8581;

/**
 * Turn what the user typed into the base URL of the Homebridge UI (no
 * trailing slash, without `/api`): `192.0.2.10`, `192.0.2.10:8581`,
 * `http://hb.example:8581`, `https://hb.example/`. Returns null when it is
 * not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  if (!hasScheme && url.port === '') {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/api$/, '')
    .replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** "a, b\nc" -> ['a', 'b', 'c'], without blanks or duplicates. Names may hold spaces. */
export function splitList(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * An accessory name pattern: `Kitchen lamp`, `Hue *`, `* battery`. Case and
 * surrounding spaces do not matter: a user rarely remembers them.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function patternToRegExp(pattern) {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/** @param {string[]} patterns */
export function matcher(patterns) {
  const regexps = patterns.map(patternToRegExp);
  return (...names) => names.some((name) => regexps.some((re) => re.test(String(name ?? ''))));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const url = normalizeUrl(typed);
  const interval = Number(source.sensor_interval);
  return {
    url,
    // An address was typed but cannot be used: said in the connection status.
    invalidUrl: typed !== '' && url === null,
    username: typeof source.username === 'string' ? source.username.trim() : '',
    // A password may start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    include: splitList(source.include_accessories),
    exclude: splitList(source.exclude_accessories),
    allow: {
      lock: source.allow_lock_commands === true,
      garage: source.allow_garage_door_commands === true,
      alarm: source.allow_alarm_commands === true,
    },
    sensorInterval: Number.isFinite(interval)
      ? Math.min(3600, Math.max(0, Math.round(interval)))
      : DEFAULT_CONFIG.sensor_interval,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
