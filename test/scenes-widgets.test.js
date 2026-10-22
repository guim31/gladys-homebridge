// Scene actions and the dashboard widget, against the fake Homebridge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { parseValue } from '../src/scenes.js';
import { statusContent } from '../src/widgets.js';
import { baseConfig, createWorld } from './helpers/world.js';

test('set_characteristic sets any writable characteristic, found by accessory name', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('set_characteristic', {
    accessory: 'living room tv',
    characteristic: 'ActiveIdentifier',
    value: '3',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.hb.commands.at(-1), {
    service: 'Living room TV',
    type: 'ActiveIdentifier',
    value: 3,
  });
  const unknown = await world.fake.sceneAction('set_characteristic', {
    accessory: 'Nope',
    characteristic: 'On',
    value: 'on',
  });
  assert.match(unknown.error, /pas d'accessoire de ce nom : Nope/);
  const readOnly = await world.fake.sceneAction('set_characteristic', {
    accessory: 'Hall motion',
    characteristic: 'MotionDetected',
    value: '1',
  });
  assert.match(readOnly.error, /caractéristique modifiable/);
});

test('scenes are no way around the security switches', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const [accessory, characteristic, value] of [
    ['Front door lock', 'LockTargetState', '0'],
    ['Garage', 'TargetDoorState', '0'],
    ['Patio door', 'TargetPosition', '100'],
    ['Alarm', 'SecuritySystemTargetState', '3'],
  ]) {
    const ack = await world.fake.sceneAction('set_characteristic', {
      accessory,
      characteristic,
      value,
    });
    assert.match(ack.error ?? '', /désactivées dans la configuration/, accessory);
  }
  const alarm = await world.fake.sceneAction('set_alarm', { mode: 'disarm' });
  assert.match(alarm.error ?? '', /désactivées dans la configuration/);
  assert.equal(world.hb.commands.length, 0);
});

test('set_alarm arms the only security system once the alarm commands are allowed', async (t) => {
  const world = await createWorld({ config: baseConfig({ allow_alarm_commands: true }) });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('set_alarm', { mode: 'night' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.hb.commands.at(-1), {
    service: 'Alarm',
    type: 'SecuritySystemTargetState',
    value: 2,
  });
  const missing = await world.fake.sceneAction('set_alarm', { mode: 'away', alarm: 'Shed' });
  assert.match(missing.error, /pas d'alarme/);
});

test('scene values are parsed as Homebridge expects them', () => {
  assert.equal(parseValue('true'), true);
  assert.equal(parseValue('OFF'), false);
  assert.equal(parseValue('21,5'), 21.5);
  assert.equal(parseValue('HDMI 1'), 'HDMI 1');
  assert.equal(parseValue('  '), undefined);
});

test('the widget shows the connection and the counts, within the core budget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet('status', { settings: {}, language: 'de' });
  assert.equal(ack.success, true, ack.error);
  for (const status of ['online', 'unreachable', 'auth_failed', 'insecure_off', 'not_configured']) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const content = statusContent(
        { status, version: '2.4.0', live: true, offered: 24, added: 3, followed: 5 },
        language,
      );
      assert.deepEqual(validateWidgetContent(content), [], `${status} ${language}`);
      assert.ok(content.components.length <= 8);
    }
  }
  const reload = await world.fake.widgetAction('status', 'reload', {});
  assert.equal(reload.success, true, reload.error);
});
