// -----------------------------------------------------------------------------
// A fake Homebridge UI: the REST API (login, accessories, PUT) and the
// Socket.IO namespace /accessories, as Homebridge 2.4.0 with UI 5.29.0 answer
// them (test/fixtures/homebridge: the list of a real instance running
// homebridge-dummy), plus a few services built from the HAP specification
// (colour bulb, security system, battery, heater-cooler, fan, TV) that
// homebridge-dummy cannot create.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const USER = 'gladys';
export const PASSWORD = 'not-a-real-password';
export const BRIDGE = '0E:00:00:00:00:01';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/homebridge/accessories-2.4.0.json', import.meta.url), 'utf8'),
);

const instance = {
  name: 'homebridge',
  username: BRIDGE,
  ipAddress: '192.0.2.10',
  port: 51826,
  services: [],
  connectionFailedCount: 0,
  configurationNumber: '3',
  pinRefusalLogged: false,
};

let serial = 0;
/** One service as the UI lists it; `chars` are [type, value, format, extra]. */
export function hapService(aid, iid, type, name, chars, accessory = name) {
  return {
    aid,
    iid,
    uuid: `0000${(serial += 1).toString(16).padStart(4, '0')}-0000-1000-8000-0026BB765291`,
    type,
    humanType: type,
    serviceName: name,
    serviceCharacteristics: chars.map(([charType, value, format, extra = {}], index) => ({
      aid,
      iid: iid + index + 1,
      type: charType,
      serviceType: type,
      serviceName: name,
      description: charType,
      value,
      format,
      perms: ['ev', 'pr', ...(extra.canWrite ? ['pw'] : [])],
      canRead: true,
      canWrite: false,
      ev: true,
      ...extra,
    })),
    accessoryInformation: { Manufacturer: 'Test', Model: type, Name: accessory },
    values: {},
    instance,
    uniqueId: `u-${aid}-${iid}-${type}`.toLowerCase(),
  };
}

const W = { canWrite: true };

/** Services homebridge-dummy cannot make, from the HAP specification. */
export function extraServices() {
  return [
    hapService(30, 9, 'Lightbulb', 'Hue lamp', [
      ['On', 1, 'bool', W],
      ['Brightness', 80, 'int', { ...W, minValue: 0, maxValue: 100, unit: 'percentage' }],
      ['Hue', 120, 'float', { ...W, minValue: 0, maxValue: 360 }],
      ['Saturation', 100, 'float', { ...W, minValue: 0, maxValue: 100 }],
      ['ColorTemperature', 300, 'uint32', { ...W, minValue: 153, maxValue: 454 }],
    ]),
    hapService(31, 9, 'SecuritySystem', 'Alarm', [
      ['SecuritySystemCurrentState', 3, 'uint8', { minValue: 0, maxValue: 4 }],
      ['SecuritySystemTargetState', 3, 'uint8', { ...W, minValue: 0, maxValue: 3 }],
    ]),
    hapService(32, 9, 'TemperatureSensor', 'Garden temperature', [
      ['CurrentTemperature', 12.5, 'float', { minValue: -270, maxValue: 100 }],
      ['StatusLowBattery', 0, 'uint8', { minValue: 0, maxValue: 1 }],
    ]),
    hapService(
      32,
      13,
      'HumiditySensor',
      'Garden humidity',
      [['CurrentRelativeHumidity', 71, 'float', { minValue: 0, maxValue: 100 }]],
      'Garden temperature',
    ),
    hapService(
      32,
      16,
      'Battery',
      'Garden battery',
      [
        ['BatteryLevel', 64, 'uint8', { minValue: 0, maxValue: 100, unit: 'percentage' }],
        ['ChargingState', 0, 'uint8', { minValue: 0, maxValue: 2 }],
        ['StatusLowBattery', 0, 'uint8', { minValue: 0, maxValue: 1 }],
      ],
      'Garden temperature',
    ),
    hapService(33, 9, 'HeaterCooler', 'Bedroom AC', [
      ['Active', 1, 'uint8', { ...W, minValue: 0, maxValue: 1 }],
      ['CurrentTemperature', 24, 'float', { minValue: 0, maxValue: 100 }],
      ['TargetHeaterCoolerState', 2, 'uint8', { ...W, minValue: 0, maxValue: 2 }],
      [
        'CoolingThresholdTemperature',
        22,
        'float',
        { ...W, minValue: 16, maxValue: 30, minStep: 0.5 },
      ],
      [
        'HeatingThresholdTemperature',
        20,
        'float',
        { ...W, minValue: 16, maxValue: 30, minStep: 0.5 },
      ],
    ]),
    hapService(34, 9, 'Fanv2', 'Ceiling fan', [
      ['Active', 0, 'uint8', { ...W, minValue: 0, maxValue: 1 }],
      ['RotationSpeed', 50, 'float', { ...W, minValue: 0, maxValue: 100, unit: 'percentage' }],
    ]),
    hapService(35, 9, 'Television', 'Living room TV', [
      ['Active', 0, 'uint8', { ...W, minValue: 0, maxValue: 1 }],
      ['ActiveIdentifier', 1, 'uint32', W],
    ]),
    hapService(36, 9, 'Doorbell', 'Front doorbell', [
      ['ProgrammableSwitchEvent', null, 'uint8', { minValue: 0, maxValue: 2 }],
    ]),
    hapService(37, 9, 'CameraRTPStreamManagement', 'Garden camera', [
      ['StreamingStatus', 'AQEA', 'tlv8'],
    ]),
  ];
}

const json = (status, body) =>
  new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Side effects of a command on a real accessory: the target becomes the current state. */
const FOLLOWERS = {
  TargetPosition: 'CurrentPosition',
  LockTargetState: 'LockCurrentState',
  TargetDoorState: 'CurrentDoorState',
  SecuritySystemTargetState: 'SecuritySystemCurrentState',
};

export function createHomebridge({
  services = [...structuredClone(fixture), ...extraServices()],
  insecure = true,
  noAuth = false,
  socket = true,
} = {}) {
  const hb = {
    services,
    insecure,
    noAuth,
    socket,
    down: false,
    tokens: new Set(),
    logins: 0,
    commands: [],
    sockets: new Set(),
    expiresIn: 28800,
  };

  const find = (uniqueId) => hb.services.find((s) => s.uniqueId === uniqueId);
  const byName = (name) => hb.services.find((s) => s.serviceName === name);
  const authorized = (init) => {
    const header = init?.headers?.Authorization ?? '';
    return hb.tokens.has(header.replace(/^Bearer /, ''));
  };
  const newToken = () => {
    const token = `token-${(hb.logins += 1)}`;
    hb.tokens.add(token);
    return json(201, { access_token: token, token_type: 'Bearer', expires_in: hb.expiresIn });
  };

  hb.emit = (list) => {
    for (const ws of hb.sockets) {
      ws.push(`42/accessories,${JSON.stringify(['accessories-data', list])}`);
    }
  };

  /** A value changed in Homebridge (a plugin, the Home app...). */
  hb.change = (name, type, value) => {
    const service = byName(name);
    const c = service.serviceCharacteristics.find((x) => x.type === type);
    c.value = value;
    hb.emit([service]);
  };

  hb.fetch = async (url, init = {}) => {
    if (hb.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === 'POST' && pathname === '/api/auth/login') {
      if (body?.username === USER && body?.password === PASSWORD) {
        return newToken();
      }
      return json(403, { message: 'Forbidden', statusCode: 403 });
    }
    if (method === 'POST' && pathname === '/api/auth/noauth') {
      return hb.noAuth ? newToken() : json(401, { message: 'Unauthorized', statusCode: 401 });
    }
    if (!authorized(init)) {
      return json(401, { message: 'Unauthorized', statusCode: 401 });
    }
    if (method === 'GET' && pathname === '/api/status/homebridge-version') {
      return json(200, { name: 'homebridge', installedVersion: '2.4.0' });
    }
    if (method === 'GET' && pathname === '/api/accessories') {
      if (!hb.insecure) {
        return json(400, {
          message: 'Homebridge must be running in insecure mode to access accessories.',
          error: 'Bad Request',
          statusCode: 400,
        });
      }
      return json(200, hb.services);
    }
    const put = pathname.match(/^\/api\/accessories\/(.+)$/);
    if (method === 'PUT' && put) {
      const service = find(decodeURIComponent(put[1]));
      if (!service) {
        return json(400, {
          message: `Service with uniqueId of '${put[1]}' not found.`,
          statusCode: 400,
        });
      }
      const c = service.serviceCharacteristics.find((x) => x.type === body.characteristicType);
      if (!c || !c.canWrite) {
        return json(400, { message: 'Invalid characteristicType.', statusCode: 400 });
      }
      hb.commands.push({ service: service.serviceName, type: c.type, value: body.value });
      c.value = typeof body.value === 'boolean' ? (body.value ? 1 : 0) : body.value;
      const follower = service.serviceCharacteristics.find((x) => x.type === FOLLOWERS[c.type]);
      if (follower) {
        follower.value = c.value;
      }
      hb.emit([service]);
      return json(200, service);
    }
    return json(404, { message: 'Not Found', statusCode: 404 });
  };

  /** The WebSocket of Node 22, as far as the client uses it. */
  hb.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.closed = false;
      hb.lastSocketUrl = url;
      queueMicrotask(() => {
        if (hb.down || !hb.socket) {
          this.onerror?.({ error: new Error('ECONNREFUSED') });
          this.close();
          return;
        }
        hb.sockets.add(this);
        this.push('0{"sid":"s1","upgrades":[],"pingInterval":25000,"pingTimeout":20000}');
      });
    }

    push(frame) {
      if (!this.closed) {
        queueMicrotask(() => this.onmessage?.({ data: frame }));
      }
    }

    send(frame) {
      if (frame.startsWith('40/accessories,')) {
        const { token } = JSON.parse(frame.slice('40/accessories,'.length));
        this.push(
          hb.tokens.has(token)
            ? '40/accessories,{"sid":"n1"}'
            : '44/accessories,{"message":"Unauthorized"}',
        );
      } else if (frame === '42/accessories,["get-accessories"]') {
        this.push('42/accessories,["hap-accessories-ready-for-control"]');
        this.push(`42/accessories,${JSON.stringify(['accessories-data', hb.services])}`);
      }
    }

    close() {
      if (!this.closed) {
        this.closed = true;
        hb.sockets.delete(this);
        queueMicrotask(() => this.onclose?.({ code: 1000 }));
      }
    }
  };

  /** Cuts every socket, like a restart of the UI. */
  hb.dropSockets = () => {
    for (const ws of [...hb.sockets]) {
      ws.close();
    }
  };

  return hb;
}
