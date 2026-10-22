// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// the fake Homebridge. Short timings: everything settles in milliseconds.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createLogger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../../src/app.js';
import { PASSWORD, USER, createHomebridge } from './fakeHomebridge.js';

export const FAST_TIMINGS = {
  reconnectMin: 20,
  reconnectMax: 80,
  authRetry: 200,
  insecureRetry: 200,
  inventoryDebounce: 20,
  pollInterval: 60_000,
  refreshInterval: 60 * 60_000,
  streamSilence: 60_000,
  streamRetryMax: 80,
};
export const FAST_PUBLISHER = { flushInterval: 10 };

export const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Waits for a condition, failing with `what` after a while. */
export async function until(check, { what = 'the condition', timeout = 2000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export const baseConfig = (extra = {}) => ({
  url: 'http://192.0.2.10:8581',
  username: USER,
  password: PASSWORD,
  ...extra,
});

/**
 * @param {object} [options]
 * @param {object} [options.hb] the fake Homebridge (default: the real accessory list)
 * @param {object} [options.config] integration config (default: the fake's address and user)
 * @param {object[]} [options.devices] devices already added in Gladys
 */
export async function createWorld({
  hb = createHomebridge(),
  config,
  devices = [],
  connect = true,
  waitOnline = true,
  logger = createLogger({ level: 'silent' }),
  timings = FAST_TIMINGS,
} = {}) {
  const gladys = createFakeGladys({ config: config ?? baseConfig(), devices });
  const app = registerHandlers(gladys, {
    fetch: hb.fetch,
    WebSocket: hb.WebSocket,
    timings,
    publisherTimings: FAST_PUBLISHER,
    logger,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    if (waitOnline && !hb.down) {
      await until(() => app.bridge.status === 'online', { what: 'Homebridge online' });
      if (hb.socket) {
        await until(() => app.bridge.live && app.bridge.streamHealthy, { what: 'the socket' });
      }
    }
  }
  return { gladys, fake: gladys.fake, app, bridge: app.bridge, hb };
}

/** The service of this name in the fake. */
export const serviceOf = (world, name) => world.hb.services.find((s) => s.serviceName === name);

/** The discovered device holding the features of this service. */
export function deviceOf(world, name) {
  const id = world.bridge.inventory.serviceDevice.get(serviceOf(world, name)?.uniqueId);
  return world.fake.discoveredDevices.find((d) => d.external_id === id);
}

/** The discovered feature of one service and role. */
export function featureOf(world, name, role) {
  const service = serviceOf(world, name);
  const device = deviceOf(world, name);
  const feature = device?.features.find(
    (f) => f.external_id === `${device.external_id}:${service.iid}-${role}`,
  );
  if (!feature) {
    throw new Error(`No feature ${role} for ${name}`);
  }
  return feature;
}

/** Adds a discovered device to Gladys, like the user in the Discovery tab. */
export async function addDevice(world, device) {
  const created = structuredClone(device);
  await world.fake.deviceCreated(created);
  await settle();
  return created;
}

/** Waits for the publisher's next flush. */
export async function flushed(world) {
  await settle();
  await world.bridge.publisher.flush();
  await settle();
}

/** The states published for one feature. */
export const statesOf = (world, featureId) =>
  world.fake.states.filter((s) => s.device_feature_external_id === featureId).map((s) => s.state);
