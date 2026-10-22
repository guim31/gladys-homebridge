// The bridge end to end: the SDK's fake Gladys on one side, the fake
// Homebridge UI (real accessory list, REST API, Socket.IO) on the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createHomebridge } from './helpers/fakeHomebridge.js';
import { captureLogs } from './helpers/logs.js';
import {
  FAST_TIMINGS,
  addDevice,
  baseConfig,
  createWorld,
  deviceOf,
  featureOf,
  flushed,
  serviceOf,
  settle,
  statesOf,
  until,
} from './helpers/world.js';

test('accessories are offered as devices, the services of one accessory together', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const garden = deviceOf(world, 'Garden temperature');
  assert.equal(garden, deviceOf(world, 'Garden humidity'));
  assert.equal(garden, deviceOf(world, 'Garden battery'));
  assert.match(garden.external_id, /:accessory:0E0000000001-32$/);
  assert.match(featureOf(world, 'Ceiling lamp', 'brightness').external_id, /-2:9-brightness$/);
  for (const device of world.fake.discoveredDevices) {
    assert.equal(device.should_poll, false, device.name);
  }
  // Buttons and alarms are scene triggers; the bridge accessory itself is not a device.
  assert.equal(deviceOf(world, 'Doorbell button'), undefined);
  assert.equal(deviceOf(world, 'Alarm'), undefined);
  assert.equal(deviceOf(world, 'Homebridge Test 669A'), undefined);
  assert.deepEqual(world.bridge.inventory.ignored, [
    ['CameraRTPStreamManagement', 1],
    ['CarbonDioxideSensor', 1],
  ]);
  assert.match(world.hb.lastSocketUrl, /^ws:\/\/192\.0\.2\.10:8581\/socket\.io\/\?EIO=4/);
});

test('values go to the devices added in Gladys only, all again when one is added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await flushed(world);
  assert.equal(world.fake.states.length, 0, 'nothing added yet');
  await addDevice(world, deviceOf(world, 'Front window'));
  await flushed(world);
  const contact = featureOf(world, 'Front window', 'contact').external_id;
  assert.deepEqual(statesOf(world, contact), [1], 'HAP 0 (contact detected) is closed: 1');
  world.hb.change('Front window', 'ContactSensorState', 1);
  await until(async () => (await flushed(world), statesOf(world, contact).length === 2), {
    what: 'the change',
  });
  assert.deepEqual(statesOf(world, contact), [1, 0], 'HAP 1 (no contact) is open: 0');
});

test('a command goes to Homebridge, its answer is the feedback', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lamp = await addDevice(world, deviceOf(world, 'Ceiling lamp'));
  const brightness = featureOf(world, 'Ceiling lamp', 'brightness');
  const ack = await world.fake.setValue(lamp, brightness, 40);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.hb.commands, [{ service: 'Ceiling lamp', type: 'Brightness', value: 40 }]);
  await until(
    async () => (await flushed(world), statesOf(world, brightness.external_id).includes(40)),
    { what: 'the feedback' },
  );
  await world.fake.setValue(lamp, featureOf(world, 'Ceiling lamp', 'on'), 1);
  assert.deepEqual(world.hb.commands.at(-1), { service: 'Ceiling lamp', type: 'On', value: true });

  const blinds = await addDevice(world, deviceOf(world, 'Bedroom blinds'));
  await world.fake.setValue(blinds, featureOf(world, 'Bedroom blinds', 'position'), 30);
  assert.deepEqual(world.hb.commands.at(-1).value, 30, 'HAP and Gladys: 100 is open');
  await world.fake.setValue(blinds, featureOf(world, 'Bedroom blinds', 'state'), -1);
  assert.deepEqual(world.hb.commands.at(-1), {
    service: 'Bedroom blinds',
    type: 'TargetPosition',
    value: 0,
  });
  const stop = await world.fake.setValue(blinds, featureOf(world, 'Bedroom blinds', 'state'), 0);
  assert.equal(stop.success, false, 'no HoldPosition: stop refused');

  const hue = await addDevice(world, deviceOf(world, 'Hue lamp'));
  await world.fake.setValue(hue, featureOf(world, 'Hue lamp', 'color'), 0xff0000);
  assert.deepEqual(world.hb.commands.slice(-2), [
    { service: 'Hue lamp', type: 'Hue', value: 0 },
    { service: 'Hue lamp', type: 'Saturation', value: 100 },
  ]);
});

test('a set point outside the bounds of the accessory is refused, not clamped', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const thermostat = await addDevice(world, deviceOf(world, 'Living thermostat'));
  const target = featureOf(world, 'Living thermostat', 'target');
  assert.deepEqual([target.min, target.max], [10, 38]);
  const ack = await world.fake.setValue(thermostat, target, 45);
  assert.equal(ack.success, false);
  assert.match(ack.error, /limites/);
  assert.equal(world.hb.commands.length, 0);
  assert.equal((await world.fake.setValue(thermostat, target, 21.5)).success, true);
  assert.deepEqual(world.hb.commands.at(-1).value, 21.5);
  const mode = featureOf(world, 'Living thermostat', 'mode');
  await world.fake.setValue(thermostat, mode, 1);
  assert.deepEqual(world.hb.commands.at(-1), {
    service: 'Living thermostat',
    type: 'TargetHeatingCoolingState',
    value: 1,
  });
});

test('locks and garage doors: read-only by default, commands refused with a clear message', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lock = await addDevice(world, deviceOf(world, 'Front door lock'));
  const state = featureOf(world, 'Front door lock', 'state');
  assert.equal(state.read_only, true);
  const ack = await world.fake.setValue(lock, state, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /serrures, portes de garage et alarmes/);
  assert.equal(world.hb.commands.length, 0);
  const garage = deviceOf(world, 'Garage');
  assert.deepEqual(
    garage.features.map((f) => `${f.category}/${f.type}`),
    ['opening-sensor/binary'],
  );
  assert.equal(featureOf(world, 'Garage', 'contact').read_only, true);
  const door = deviceOf(world, 'Patio door');
  assert.ok(door.features.every((f) => f.read_only));
});

test('locks and garage doors obey once their family is allowed, each on its own', async (t) => {
  const world = await createWorld({
    config: baseConfig({ allow_lock_commands: true }),
  });
  t.after(() => world.app.stop());
  const lock = await addDevice(world, deviceOf(world, 'Front door lock'));
  await flushed(world);
  const state = featureOf(world, 'Front door lock', 'state');
  assert.deepEqual(statesOf(world, state.external_id), [1], 'secured is locked: 1');
  assert.equal((await world.fake.setValue(lock, state, 0)).success, true);
  assert.deepEqual(world.hb.commands.at(-1), {
    service: 'Front door lock',
    type: 'LockTargetState',
    value: 0,
  });
  await until(async () => (await flushed(world), statesOf(world, state.external_id).includes(0)), {
    what: 'the unlocked state',
  });
  assert.equal(deviceOf(world, 'Garage').features.length, 1, 'garage doors still read-only');
});

test('a button press starts the trigger; the whole list at the opening does not', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await settle();
  assert.deepEqual(world.fake.sceneEvents, [], 'old presses of the whole list are not presses');
  world.hb.change('Doorbell button', 'ProgrammableSwitchEvent', 1);
  world.hb.change('Front doorbell', 'ProgrammableSwitchEvent', 0);
  await until(() => world.fake.sceneEvents.length === 2, { what: 'the presses' });
  assert.deepEqual(
    world.fake.sceneEvents.map((e) => [e.key ?? e.trigger_key, e.data ?? e.variables]),
    [
      [
        'button_pressed',
        { accessory: 'Doorbell button', button: 'Doorbell button', press: 'double' },
      ],
      [
        'button_pressed',
        { accessory: 'Front doorbell', button: 'Front doorbell', press: 'single' },
      ],
    ],
  );
});

test('an alarm armed or triggered in Homebridge starts the alarm trigger', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.hb.change('Alarm', 'SecuritySystemCurrentState', 1);
  world.hb.change('Alarm', 'SecuritySystemCurrentState', 4);
  await until(() => world.fake.sceneEvents.length === 2, { what: 'the alarm events' });
  assert.deepEqual(
    world.fake.sceneEvents.map((e) => e.data ?? e.variables),
    [
      { accessory: 'Alarm', state: 'away', previous_state: 'disarmed' },
      { accessory: 'Alarm', state: 'triggered', previous_state: 'away' },
    ],
  );
});

test('a refused login is said, and tried again slowly (the UI locks accounts out)', async (t) => {
  const hb = createHomebridge();
  const world = await createWorld({
    hb,
    config: baseConfig({ password: 'wrong' }),
    waitOnline: false,
  });
  t.after(() => world.app.stop());
  await until(() => world.bridge.status === 'auth_failed', { what: 'auth_failed' });
  assert.match(world.fake.connectionStatus?.message?.fr ?? '', /refuse la connexion/);
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  const logins = hb.logins;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(hb.logins, logins, 'no new attempt before authRetry');
});

test('without insecure mode, the status says how to enable it', async (t) => {
  const hb = createHomebridge({ insecure: false });
  const world = await createWorld({ hb, waitOnline: false });
  t.after(() => world.app.stop());
  await until(() => world.bridge.status === 'insecure_off', { what: 'insecure_off' });
  assert.match(world.fake.connectionStatus?.message?.en ?? '', /insecure mode/);
  hb.insecure = true;
  await until(() => world.bridge.status === 'online', { what: 'online again' });
});

test('a UI without login gives its token through /noauth; an expired token is renewed', async (t) => {
  const hb = createHomebridge({ noAuth: true });
  const world = await createWorld({ hb, config: baseConfig({ username: '', password: '' }) });
  t.after(() => world.app.stop());
  assert.equal(world.bridge.status, 'online');
  hb.tokens.clear();
  await world.bridge.scan();
  assert.equal(world.bridge.status, 'online', 'a 401 renews the token once');
  assert.equal(hb.logins, 2);
});

test('Homebridge lost: devices unreachable, then back, without a log line per attempt', async (t) => {
  const logs = captureLogs(t, 'info');
  const hb = createHomebridge();
  const world = await createWorld({ hb, logger: createLogger({ name: 'homebridge' }) });
  t.after(() => world.app.stop());
  const lamp = await addDevice(world, deviceOf(world, 'Ceiling lamp'));
  hb.down = true;
  hb.dropSockets();
  await world.bridge.scan();
  await until(() => world.bridge.status === 'unreachable', { what: 'unreachable' });
  await until(
    () =>
      world.fake.transports.some(
        (e) =>
          (e.device_external_id ?? e.external_id) === lamp.external_id &&
          e.transport === 'unreachable',
      ),
    { what: 'the unreachable badge' },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  hb.down = false;
  await until(() => world.bridge.status === 'online' && world.bridge.live, { what: 'back' });
  const lines = logs.stop();
  assert.equal(lines.filter((l) => /unreachable/.test(l)).length, 1, lines.join('\n'));
  assert.equal(lines.filter((l) => /Connected again/.test(l)).length, 1, lines.join('\n'));
});

test('without the socket, the container reads the list itself (no onPoll)', async (t) => {
  const hb = createHomebridge({ socket: false });
  const world = await createWorld({
    hb,
    timings: { ...FAST_TIMINGS, pollInterval: 30 },
  });
  t.after(() => world.app.stop());
  assert.equal(world.bridge.live, false);
  await addDevice(world, deviceOf(world, 'Hall motion'));
  const motion = featureOf(world, 'Hall motion', 'motion').external_id;
  serviceOf(world, 'Hall motion').serviceCharacteristics[0].value = 1;
  await until(async () => (await flushed(world), statesOf(world, motion).includes(1)), {
    what: 'the polled value',
  });
});

test('a normal cycle writes nothing at info level', async (t) => {
  const world = await createWorld({ logger: createLogger({ name: 'homebridge' }) });
  t.after(() => world.app.stop());
  await addDevice(world, deviceOf(world, 'Hall motion'));
  const logs = captureLogs(t, 'info');
  world.hb.change('Hall motion', 'MotionDetected', 1);
  world.hb.change('Living temperature', 'CurrentTemperature', 21);
  await world.bridge.refresh();
  await flushed(world);
  assert.deepEqual(logs.stop(), []);
});
