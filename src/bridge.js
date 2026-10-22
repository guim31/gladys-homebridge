// -----------------------------------------------------------------------------
// The bridge: one Homebridge UI, its accessories, the live values, the
// commands and the scene events.
//
//   connect    POST /api/auth/login (or /noauth), GET /api/accessories;
//   inventory  src/inventory.js -> publishDiscoveredDevices (Discovery tab);
//   live       the Socket.IO namespace /accessories of the UI: each change of
//              a characteristic -> the features of the devices ADDED in Gladys
//              only (the others would be dropped by the core and spend its 300
//              states/min); an unknown service -> the list is read again;
//   fallback   no socket (cut, refused by a proxy): the list is read every
//              30 s, and the socket is opened again with a growing delay;
//   watchdog   the UI pings every 25 s: a silent socket is reopened;
//   commands   onSetValue -> PUT /api/accessories/{uniqueId}; its answer
//              holds the values read back, the feedback;
//   events     buttons (StatelessProgrammableSwitch, Doorbell) -> trigger
//              `button_pressed`; security systems -> trigger `alarm_changed`;
//   failures   Homebridge lost -> unreachable badges, new attempt after 5 s,
//              doubling up to 60 s; refused login: every 5 minutes (the UI
//              locks an account out after 10 failures in 5 minutes);
//              insecure mode off: every minute.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  HbAuthError,
  HbHttpError,
  HbInsecureError,
  HomebridgeClient,
} from './homebridge/client.js';
import { accessoryName, buildInventory } from './inventory.js';
import { WriteError, charOf, numberOf } from './mapping.js';
import { StatePublisher } from './publisher.js';
import { ERRORS, STATUS, localizedError, testMessage } from './texts.js';

export const BRIDGE_TIMINGS = {
  reconnectMin: 5000,
  reconnectMax: 60_000,
  authRetry: 5 * 60_000,
  insecureRetry: 60_000,
  inventoryDebounce: 2000,
  // Without the socket, the accessories are read this often.
  pollInterval: 30_000,
  // With it, they are read again hourly anyway: the heartbeat of the values, and a safety net.
  refreshInterval: 60 * 60_000,
  // The UI pings every 25 s: a socket silent for longer is dead.
  streamSilence: 60_000,
  streamRetryMax: 5 * 60_000,
};

export const TRIGGERS = { BUTTON_PRESSED: 'button_pressed', ALARM_CHANGED: 'alarm_changed' };
export const WIDGET_KEY = 'status';

/** HAP ProgrammableSwitchEvent -> the `press` of the trigger. */
export const PRESSES = { 0: 'single', 1: 'double', 2: 'long' };
/** HAP SecuritySystemCurrentState -> the `state` of the trigger. */
export const ALARM_STATES = { 0: 'home', 1: 'away', 2: 'night', 3: 'disarmed', 4: 'triggered' };
export const BUTTON_SERVICES = new Set(['StatelessProgrammableSwitch', 'Doorbell']);

/** Scene events per minute: the core takes 300, a chatty accessory must not spend them all. */
export const EVENTS_PER_MINUTE = 120;

/** The core refuses a discovered list longer than this (setDiscoveredDevices, 5.2.0). */
export const MAX_DISCOVERED_DEVICES = 2000;

const short = (value, max = 255) => {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) : text;
};

/** What the inventory is built from: a change here offers the devices again. */
const structureOf = (services) =>
  JSON.stringify(
    services.map((s) => [
      s.uniqueId,
      s.type,
      s.serviceName,
      s.accessoryInformation?.Name,
      s.instance?.name,
      (s.serviceCharacteristics ?? []).map((c) => [
        c.type,
        c.canWrite,
        c.minValue,
        c.maxValue,
        c.validValues,
      ]),
    ]),
  );

/** A HomeKit service of GET /api/accessories, not a Matter one of the socket. */
const isHap = (service) =>
  Number.isFinite(service?.aid) && service.aid > 0 && !service.uniqueId.startsWith('matter:');

/**
 * While Homebridge restarts, the UI stays up and answers an empty list (its
 * HAP client fails, the error is swallowed): taken as a loss, not as "no more
 * accessories", which would empty the Discovery tab.
 */
function notEmptied(services, previous) {
  if (services.length === 0 && previous.size > 0) {
    throw new Error('empty accessory list (Homebridge restarting?)');
  }
  return services;
}

/** The characteristic types of a service, to tell a value change from a new structure. */
const shapeOf = (service) =>
  (service?.serviceCharacteristics ?? [])
    .map((c) => c?.type)
    .sort()
    .join(',');

export class Bridge {
  constructor({
    gladys,
    logger,
    fetch,
    WebSocket,
    timers = globalThis,
    timings = BRIDGE_TIMINGS,
    clientTimings,
    publisherTimings,
    now = Date.now,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.fetch = fetch;
    this.WebSocket = WebSocket;
    this.timers = timers;
    this.timings = { ...BRIDGE_TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now;
    this.publisher = new StatePublisher({
      gladys,
      logger,
      now,
      timers,
      timings: publisherTimings,
    });
    this.config = normalizeConfig({});
    this.configKey = undefined;
    this.status = 'not_configured';
    this.version = undefined;
    this.client = undefined;
    /** service uniqueId -> service (its values kept up to date by the socket) */
    this.services = new Map();
    this.structure = undefined;
    this.inventory = this.emptyInventory();
    this.generation = 0;
    this.reconnectTimer = undefined;
    this.inventoryTimer = undefined;
    this.tickTimer = undefined;
    this.streamTimer = undefined;
    this.stream = undefined;
    this.live = false;
    this.streamHealthy = false;
    this.streamSeq = 0;
    this.streamFailing = false;
    this.lastEventAt = 0;
    this.lastRefreshAt = 0;
    this.delay = this.timings.reconnectMin;
    this.streamDelay = this.timings.reconnectMin;
    this.transports = new Map();
    this.eventWindow = [];
    this.eventsDropped = false;
  }

  emptyInventory() {
    return buildInventory([], { externalIds: this.gladys.externalIds.bind(this.gladys) });
  }

  // --- Configuration and lifecycle -----------------------------------------------

  /** Applies a configuration; restarts the connection when it changed. */
  async configure(raw) {
    const key = JSON.stringify(raw ?? {});
    if (key === this.configKey && this.status !== 'not_configured') {
      return;
    }
    this.configKey = key;
    this.config = normalizeConfig(raw);
    this.publisher.setInterval(this.config.sensorInterval);
    await this.restart();
  }

  async restart() {
    this.disconnect();
    this.generation += 1;
    this.delay = this.timings.reconnectMin;
    this.streamDelay = this.timings.reconnectMin;
    this.structure = undefined;
    // Nothing of the previous server survives a new configuration.
    this.services = new Map();
    this.transports.clear();
    this.inventory = this.emptyInventory();
    this.publisher.clear();
    this.publisher.start();
    if (this.config.invalidUrl || !this.config.url) {
      this.status = this.config.invalidUrl ? 'invalid_url' : 'not_configured';
      await this.setConnectionStatus(false, STATUS[this.status]);
      return;
    }
    await this.connect(this.generation);
  }

  /** Stops everything (shutdown, tests). */
  stop() {
    this.generation += 1;
    this.disconnect();
    this.publisher.stop();
  }

  disconnect() {
    for (const timer of [this.reconnectTimer, this.inventoryTimer, this.streamTimer]) {
      this.timers.clearTimeout(timer);
    }
    this.timers.clearInterval(this.tickTimer);
    this.reconnectTimer = undefined;
    this.inventoryTimer = undefined;
    this.streamTimer = undefined;
    this.tickTimer = undefined;
    this.closeStream();
    this.client = undefined;
  }

  closeStream() {
    this.streamSeq += 1;
    const stream = this.stream;
    this.stream = undefined;
    this.live = false;
    stream?.close();
  }

  async setConnectionStatus(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.logger.debug(`Connection status not sent: ${err.message}`);
    }
  }

  isDown() {
    return ['unreachable', 'auth_failed', 'insecure_off'].includes(this.status);
  }

  async connect(generation) {
    if (generation !== this.generation) {
      return;
    }
    if (!this.isDown()) {
      this.status = 'connecting';
    }
    const client = new HomebridgeClient({
      baseUrl: this.config.url,
      username: this.config.username,
      password: this.config.password,
      fetch: this.fetch,
      WebSocket: this.WebSocket,
      now: this.now,
      timings: this.clientTimings,
    });
    let services;
    try {
      services = await client.getAccessories();
      this.version = (await client.getVersion()) || undefined;
    } catch (err) {
      if (generation === this.generation) {
        await this.onFailure(generation, err);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    const wasDown = this.isDown();
    this.client = client;
    this.status = 'online';
    this.delay = this.timings.reconnectMin;
    await this.applyServices(services, { force: true });
    this.logger.info(
      `${wasDown ? 'Connected again' : 'Connected'} to Homebridge${this.version ? ` ${this.version}` : ''}: ${this.inventory.devices.length} devices, ${this.inventory.serviceCount} services`,
    );
    await this.setConnectionStatus(true);
    await this.publishTransports();
    this.requestWidgetRefresh();
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = this.timers.setInterval(() => {
      this.tick(generation).catch((err) => this.logger.debug(`Tick failed: ${err.message}`));
    }, this.timings.pollInterval);
    this.openStream(generation);
  }

  async onFailure(generation, err) {
    const status =
      err instanceof HbAuthError
        ? 'auth_failed'
        : err instanceof HbInsecureError
          ? 'insecure_off'
          : 'unreachable';
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    this.timers.clearTimeout(this.streamTimer);
    this.closeStream();
    this.client = undefined;
    if (this.status !== status) {
      // One line at the first failure, one at the recovery: not one per attempt.
      const lines = {
        auth_failed: `Homebridge refused the login (${err.message})`,
        insecure_off: 'Homebridge does not run in insecure mode: the accessories cannot be read',
        unreachable: `Homebridge is unreachable: ${err.message}`,
      };
      this.logger.warn(lines[status]);
    }
    this.status = status;
    await this.setConnectionStatus(false, STATUS[status]);
    await this.publishTransports();
    this.requestWidgetRefresh();
    this.timers.clearTimeout(this.reconnectTimer);
    const delay =
      status === 'auth_failed'
        ? this.timings.authRetry
        : status === 'insecure_off'
          ? this.timings.insecureRetry
          : this.delay;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(generation).catch((e) => this.logger.error(e.message));
    }, delay);
    if (status === 'unreachable') {
      this.delay = Math.min(this.delay * 2, this.timings.reconnectMax);
    }
  }

  // --- Socket --------------------------------------------------------------------

  async openStream(generation) {
    if (generation !== this.generation || this.status !== 'online' || !this.client) {
      return;
    }
    this.streamSeq += 1;
    const seq = this.streamSeq;
    // Before the opening: the whole list may arrive before `openEvents` resolves.
    this.streamHealthy = false;
    let stream;
    try {
      stream = await this.client.openEvents((event) => this.onStreamEvent(event, stream));
    } catch (err) {
      if (generation === this.generation && seq === this.streamSeq) {
        this.onStreamDown(generation, err.message);
      }
      return;
    }
    // A newer attempt (after a loss and a reconnection) owns the socket now.
    if (generation !== this.generation || this.status !== 'online' || seq !== this.streamSeq) {
      stream.close();
      return;
    }
    this.stream?.close();
    this.stream = stream;
    this.live = true;
    this.lastEventAt = this.now();
    stream.done.then(() => {
      if (this.stream === stream) {
        this.stream = undefined;
        this.live = false;
        this.onStreamDown(generation, 'socket closed');
      }
    });
  }

  onStreamDown(generation, reason) {
    if (generation !== this.generation || this.status !== 'online') {
      return;
    }
    if (!this.streamFailing) {
      this.streamFailing = true;
      this.logger.warn(`Homebridge socket unavailable (${reason}): accessories read every 30 s`);
      this.requestWidgetRefresh();
    }
    this.timers.clearTimeout(this.streamTimer);
    this.streamTimer = this.timers.setTimeout(() => {
      this.streamTimer = undefined;
      this.openStream(generation).catch(() => {});
    }, this.streamDelay);
    this.streamDelay = Math.min(this.streamDelay * 2, this.timings.streamRetryMax);
  }

  onStreamEvent(event, stream) {
    if (stream && stream !== this.stream) {
      return;
    }
    this.lastEventAt = this.now();
    if (event.type !== 'data') {
      return;
    }
    if (!this.streamHealthy) {
      // Healthy at its first data only: a proxy that accepts the socket and closes it
      // must not reset the delay nor log a recovery every few seconds.
      this.streamHealthy = true;
      this.streamDelay = this.timings.reconnectMin;
      if (this.streamFailing) {
        this.streamFailing = false;
        this.logger.info('Homebridge socket works again');
        this.requestWidgetRefresh();
      }
    }
    // The whole list (at the opening, after a reload) holds the ProtocolInformation
    // service of each bridge, which has no events: a change never does. A button
    // press is a change: the value of a whole list is an old press. (Not aid 1:
    // an unbridged accessory, a video doorbell often, has aid 1 too.)
    const whole = event.services.some((s) => s?.type === 'ProtocolInformation');
    this.onServices(event.services, { presses: !whole });
  }

  /** Values of some services, from the socket or a command answer. */
  onServices(services, { presses = false } = {}) {
    for (const service of services) {
      // Matter services (uniqueId "matter:…", aid 0) come over the socket but are never
      // in GET /api/accessories: unknown each time, they would make the list read again.
      if (typeof service?.uniqueId !== 'string' || !isHap(service)) {
        continue;
      }
      const previous = this.services.get(service.uniqueId);
      if (!previous || shapeOf(previous) !== shapeOf(service)) {
        // A service created or changed since the last read: the list is read again.
        this.scheduleInventory();
        if (!previous) {
          continue;
        }
      }
      this.services.set(service.uniqueId, service);
      this.pushService(service.uniqueId);
      this.sceneEvents(previous, service, { presses });
    }
  }

  /** Every 30 s: the list when the socket is down or the hour has passed, the watchdog. */
  async tick(generation) {
    if (generation !== this.generation || this.status !== 'online') {
      return;
    }
    const now = this.now();
    if (this.live && now - this.lastEventAt > this.timings.streamSilence) {
      this.logger.debug('Homebridge socket silent: reopened');
      // Detached first: closing a socket to a dead host may only end when TCP gives up.
      const stream = this.stream;
      this.stream = undefined;
      this.live = false;
      stream?.close();
      this.onStreamDown(generation, 'socket silent');
    }
    if (!this.live || now - this.lastRefreshAt >= this.timings.refreshInterval) {
      await this.refresh(generation);
    }
  }

  // --- Services and inventory ----------------------------------------------------

  async refresh(generation = this.generation) {
    if (generation !== this.generation || this.status !== 'online' || !this.client) {
      return;
    }
    let services;
    try {
      services = notEmptied(await this.client.getAccessories(), this.services);
    } catch (err) {
      if (generation === this.generation && this.status === 'online') {
        await this.onFailure(generation, err);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    await this.applyServices(services);
  }

  /** New service list: values updated, devices offered again when the structure changed. */
  async applyServices(services, { force = false } = {}) {
    const previous = this.services;
    this.services = new Map(
      services.filter((s) => typeof s?.uniqueId === 'string').map((s) => [s.uniqueId, s]),
    );
    this.lastRefreshAt = this.now();
    const structure = structureOf([...this.services.values()]);
    if (force || structure !== this.structure) {
      this.structure = structure;
      this.inventory = buildInventory([...this.services.values()], {
        ...this.config,
        externalIds: this.gladys.externalIds.bind(this.gladys),
      });
      await this.publishDevices();
      if (!force) {
        await this.publishTransports();
      }
    }
    // Without the socket, the alarms start their scenes from here (never the buttons).
    if (!force) {
      for (const [id, service] of this.services) {
        this.sceneEvents(previous.get(id), service, { presses: false });
      }
    }
    this.pushAll();
  }

  async publishDevices() {
    if (!this.gladys.connected) {
      return;
    }
    let devices = this.inventory.devices;
    if (devices.length > MAX_DISCOVERED_DEVICES) {
      // The core refuses the whole list beyond it: the first ones are offered.
      this.logger.warn(
        `${devices.length} devices: only the first ${MAX_DISCOVERED_DEVICES} are offered, narrow the selection`,
      );
      devices = devices.slice(0, MAX_DISCOVERED_DEVICES);
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  scheduleInventory(delay = this.timings.inventoryDebounce) {
    if (this.inventoryTimer) {
      return;
    }
    const generation = this.generation;
    this.inventoryTimer = this.timers.setTimeout(() => {
      this.inventoryTimer = undefined;
      this.refresh(generation).catch((err) =>
        this.logger.warn(`Reading the Homebridge accessories failed: ${err.message}`),
      );
    }, delay);
  }

  /** Scan button, widget "Reload": the list now, and the devices offered again. */
  async scan() {
    if (this.status === 'online' && this.client) {
      this.structure = undefined;
      await this.refresh();
    } else {
      await this.publishDevices();
    }
  }

  // --- States --------------------------------------------------------------------

  /** The external ids of the features of OUR devices added in Gladys. */
  createdFeatures() {
    const ids = new Set();
    for (const device of this.gladys.devices ?? []) {
      for (const feature of device.features ?? []) {
        ids.add(feature.external_id);
      }
    }
    return ids;
  }

  pushService(uniqueId, created = this.createdFeatures()) {
    const service = this.services.get(uniqueId);
    for (const route of this.inventory.routes.get(uniqueId) ?? []) {
      if (!service || !created.has(route.featureId)) {
        continue;
      }
      let value;
      try {
        value = route.read(service);
      } catch {
        value = null;
      }
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        this.publisher.push(route.featureId, value, route.throttle);
      }
    }
  }

  pushAll() {
    const created = this.createdFeatures();
    for (const uniqueId of this.inventory.routes.keys()) {
      this.pushService(uniqueId, created);
    }
  }

  /** unreachable for every device while Homebridge is. */
  async publishTransports() {
    if (!this.gladys.connected) {
      return;
    }
    const offered = new Set(this.inventory.devices.map((d) => d.external_id));
    const transport =
      this.status === 'online' ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    for (const device of this.gladys.devices ?? []) {
      const id = device.external_id;
      // While Homebridge is down the inventory is the last one read.
      if (offered.has(id) && this.transports.get(id) !== transport) {
        this.transports.set(id, transport);
        entries.push({ external_id: id, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      try {
        await this.gladys.publishTransports(entries.slice(i, i + 100));
      } catch (err) {
        for (const entry of entries.slice(i, i + 100)) {
          this.transports.delete(entry.external_id);
        }
        this.logger.debug(`Transport badges not sent: ${err.message}`);
      }
    }
  }

  // --- Gladys events -------------------------------------------------------------

  async onGladysConnected() {
    this.transports.clear();
    if (
      this.configKey === undefined ||
      JSON.stringify(this.gladys.config ?? {}) !== this.configKey
    ) {
      await this.configure(this.gladys.config ?? {});
      return;
    }
    await this.publishDevices();
    this.pushAll();
    await this.publishTransports();
  }

  async onDeviceCreated(device) {
    // The SDK forgot the values of this device: they are sent again now.
    this.publisher.forget(device.external_id);
    this.transports.delete(device.external_id);
    this.pushAll();
    await this.publishTransports();
    this.requestWidgetRefresh();
  }

  async onDeviceDeleted(device) {
    this.publisher.forget(device.external_id);
    this.transports.delete(device.external_id);
    this.requestWidgetRefresh();
  }

  requestWidgetRefresh() {
    if (this.gladys.connected) {
      // Fire-and-forget in the SDK: it may return nothing.
      Promise.resolve()
        .then(() => this.gladys.requestWidgetRefresh(WIDGET_KEY))
        .catch(() => {});
    }
  }

  // --- Commands ------------------------------------------------------------------

  error(key, detail = '') {
    return localizedError(ERRORS[key], this.config.language, detail);
  }

  /** Characteristics to set on one service, the one way out for devices and scenes. */
  async write(uniqueId, writes) {
    if (this.status !== 'online' || !this.client) {
      throw this.error('offline');
    }
    let answer;
    try {
      for (const { type, value } of writes) {
        try {
          answer = await this.client.setCharacteristic(uniqueId, type, value);
        } catch (err) {
          throw this.translate(err);
        }
      }
    } finally {
      // The answer is the service read back: the feedback, without waiting for the
      // socket, even when a later write of the same command failed.
      if (answer && answer.uniqueId === uniqueId) {
        this.onServices([answer]);
      }
    }
  }

  translate(err) {
    if (err instanceof HbAuthError) {
      return this.error('refused', err.message);
    }
    if (err instanceof HbHttpError) {
      return this.error('refused', err.detail || err.message);
    }
    return this.error('refused', err.message);
  }

  async setValue(device, feature, value) {
    const id = feature.external_id;
    const writer = this.inventory.writers.get(id);
    if (!writer) {
      const uniqueId = this.inventory.featureService.get(id);
      if (uniqueId && this.inventory.security.has(uniqueId)) {
        throw this.error('security_disabled');
      }
      throw this.error('unknown_feature');
    }
    let writes;
    try {
      writes = writer.write(value, this.services.get(writer.uniqueId));
    } catch (err) {
      if (err instanceof WriteError) {
        throw this.error(err.key);
      }
      throw err;
    }
    const service = this.services.get(writer.uniqueId);
    this.logger.info(
      `Command: ${writes.map((w) => `${w.type}=${w.value}`).join(', ')} to ${service?.serviceName ?? writer.uniqueId}`,
    );
    await this.write(writer.uniqueId, writes);
  }

  // --- Scene events --------------------------------------------------------------

  sceneEvents(previous, service, { presses }) {
    const name = short(accessoryName(service) || service.serviceName);
    if (BUTTON_SERVICES.has(service.type) && presses) {
      const press = PRESSES[numberOf(service, 'ProgrammableSwitchEvent')];
      if (press) {
        this.sceneEvent(TRIGGERS.BUTTON_PRESSED, {
          accessory: name,
          button: short(service.serviceName || name),
          press,
        });
      }
    }
    if (service.type === 'SecuritySystem' && previous) {
      const before = ALARM_STATES[numberOf(previous, 'SecuritySystemCurrentState')];
      const after = ALARM_STATES[numberOf(service, 'SecuritySystemCurrentState')];
      if (after && before && after !== before) {
        this.sceneEvent(TRIGGERS.ALARM_CHANGED, {
          accessory: name,
          state: after,
          previous_state: before,
        });
      }
    }
  }

  sceneEvent(key, data) {
    const now = this.now();
    this.eventWindow = this.eventWindow.filter((t) => now - t < 60_000);
    if (this.eventWindow.length >= EVENTS_PER_MINUTE) {
      if (!this.eventsDropped) {
        this.eventsDropped = true;
        this.logger.warn(
          `More than ${EVENTS_PER_MINUTE} Homebridge events in a minute: the next ones are dropped`,
        );
      }
      return;
    }
    this.eventsDropped = false;
    this.eventWindow.push(now);
    this.gladys
      .publishSceneEvent(key, data)
      .catch((err) => this.logger.debug(`Scene event ${key} not sent: ${err.message}`));
  }

  // --- Scene actions helpers -----------------------------------------------------

  /** The services of an accessory, found by its name or a service name (case-insensitive). */
  findServices(name, filter = () => true) {
    const wanted = String(name ?? '')
      .trim()
      .toLowerCase();
    return [...this.services.values()].filter(
      (s) =>
        filter(s) &&
        (accessoryName(s).toLowerCase() === wanted ||
          String(s.serviceName ?? '')
            .trim()
            .toLowerCase() === wanted),
    );
  }

  charOf(service, type) {
    return charOf(service, type);
  }

  // --- Connection test, widget ---------------------------------------------------

  async testConnection() {
    if (this.status === 'online') {
      return testMessage({
        version: this.version,
        devices: this.inventory.devices.length,
        services: this.inventory.serviceCount,
        ignored: this.inventory.ignored,
      });
    }
    const status = ['connecting', 'online'].includes(this.status) ? 'unreachable' : this.status;
    throw localizedError(STATUS[status], this.config.language);
  }

  summary() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const added = this.inventory.devices.filter((d) => created.has(d.external_id));
    let followed = 0;
    for (const [, deviceId] of this.inventory.serviceDevice) {
      if (created.has(deviceId)) {
        followed += 1;
      }
    }
    return {
      status: this.status,
      version: this.version,
      live: this.live,
      offered: this.inventory.devices.length,
      added: added.length,
      followed,
    };
  }
}
