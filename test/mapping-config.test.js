// The pure parts: HAP services -> features, the configuration, the client.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeUrl, matcher } from '../src/config.js';
import { HbInsecureError, HomebridgeClient } from '../src/homebridge/client.js';
import {
  AC_MODE,
  COVER_STATE,
  OPENING_SENSOR_STATE,
  hsToInt,
  intToHs,
  mapService,
} from '../src/mapping.js';
import { createHomebridge, extraServices, hapService } from './helpers/fakeHomebridge.js';

const W = { canWrite: true };
const role = (features, name) => features.find((f) => f.role === name);

test('the address of the UI: port 8581 by default, no credentials, no /api', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'http://192.0.2.10:8581');
  assert.equal(normalizeUrl('https://hb.example/api/'), 'https://hb.example');
  assert.equal(normalizeUrl('http://user:pw@192.0.2.10'), null);
  assert.equal(normalizeUrl('ftp://192.0.2.10'), null);
  assert.equal(normalizeConfig({ url: 'not a url ::' }).invalidUrl, true);
  const config = normalizeConfig({ include_accessories: 'Living*, Garage\n Hall motion ' });
  assert.deepEqual(config.include, ['Living*', 'Garage', 'Hall motion']);
  assert.deepEqual(config.allow, { lock: false, garage: false, alarm: false });
  assert.equal(config.language, 'fr');
  const match = matcher(config.include);
  assert.ok(match('living room tv'));
  assert.ok(match('x', 'HALL MOTION'));
  assert.ok(!match('Garage door'));
});

test('a contact sensor is inverted: HAP 0 (contact) is closed, Gladys 1', () => {
  const service = hapService(8, 9, 'ContactSensor', 'Door', [['ContactSensorState', 0, 'uint8']]);
  const [contact] = mapService(service);
  assert.equal(contact.spec.category, 'opening-sensor');
  assert.equal(contact.read(service), OPENING_SENSOR_STATE.CLOSE);
  service.serviceCharacteristics[0].value = 1;
  assert.equal(contact.read(service), OPENING_SENSOR_STATE.OPEN);
});

test('a garage door is open unless HAP says CLOSED, and only commanded when allowed', () => {
  const service = hapService(17, 9, 'GarageDoorOpener', 'Garage', [
    ['CurrentDoorState', 2, 'uint8'],
    ['TargetDoorState', 0, 'uint8', W],
  ]);
  assert.deepEqual(
    mapService(service).map((f) => f.role),
    ['contact'],
  );
  const features = mapService(service, { allow: { garage: true } });
  assert.equal(role(features, 'contact').read(service), OPENING_SENSOR_STATE.OPEN, 'opening');
  service.serviceCharacteristics[0].value = 1;
  assert.equal(role(features, 'contact').read(service), OPENING_SENSOR_STATE.CLOSE);
  assert.deepEqual(role(features, 'command').write(COVER_STATE.OPEN), [
    { type: 'TargetDoorState', value: 0 },
  ]);
  assert.throws(() => role(features, 'command').write(COVER_STATE.STOP), /unsupported_value/);
});

test('colours: HAP hue and saturation to RGB and back', () => {
  assert.equal(hsToInt(0, 100), 0xff0000);
  assert.equal(hsToInt(120, 100), 0x00ff00);
  assert.deepEqual(intToHs(0x0000ff), { h: 240, s: 100 });
  assert.deepEqual(intToHs(0xffffff), { h: 0, s: 0 });
});

test('a heater-cooler: modes translated, the set point of the current mode', () => {
  const service = extraServices().find((s) => s.type === 'HeaterCooler');
  const features = mapService(service);
  const mode = role(features, 'mode');
  assert.equal(mode.read(service), AC_MODE.COOLING, 'HAP 2 is cooling');
  assert.deepEqual(mode.write(AC_MODE.HEATING), [{ type: 'TargetHeaterCoolerState', value: 1 }]);
  assert.throws(() => mode.write(3), /unsupported_value/, 'no drying');
  const target = role(features, 'target');
  assert.equal(target.read(service), 22, 'cooling threshold in COOL');
  assert.deepEqual(target.write(23.4, service), [
    { type: 'CoolingThresholdTemperature', value: 23.5 },
  ]);
  assert.throws(() => target.write(40, service), /out_of_range/);
  service.serviceCharacteristics[2].value = 0;
  assert.equal(target.read(service), null, 'no single set point in AUTO');
});

test('a lock is read-only by default, whatever the plugin allows', () => {
  const service = hapService(16, 9, 'LockMechanism', 'Lock', [
    ['LockCurrentState', 2, 'uint8'],
    ['LockTargetState', 1, 'uint8', W],
  ]);
  const [state] = mapService(service);
  assert.equal(state.write, undefined);
  assert.equal(state.spec.read_only, true);
  assert.equal(state.read(service), null, 'jammed is no state');
  const [allowed] = mapService(service, { allow: { lock: true } });
  assert.deepEqual(allowed.write(0), [{ type: 'LockTargetState', value: 0 }]);
});

test('services Gladys has nothing for are listed, buttons and alarms are silent', () => {
  assert.deepEqual(mapService(hapService(1, 9, 'Speaker', 'S', [['Mute', 0, 'bool', W]])), {
    skipped: 'Speaker',
  });
  assert.equal(mapService(hapService(1, 9, 'Doorbell', 'D', [])), null);
  assert.equal(mapService(hapService(1, 9, 'SecuritySystem', 'A', [])), null);
});

test('the client says when insecure mode is off, and never sends the password twice', async () => {
  const hb = createHomebridge({ insecure: false });
  const client = new HomebridgeClient({
    baseUrl: 'http://192.0.2.10:8581',
    username: 'gladys',
    password: 'not-a-real-password',
    fetch: hb.fetch,
  });
  await assert.rejects(client.getAccessories(), HbInsecureError);
  await assert.rejects(client.getAccessories(), HbInsecureError);
  assert.equal(hb.logins, 1, 'the token is kept');
});
