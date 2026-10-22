// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers: these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES } from '../src/config.js';
import { ALARM_STATES, PRESSES, TRIGGERS, WIDGET_KEY } from '../src/bridge.js';
import { ALARM_TARGETS, SCENE_ACTION_KEYS } from '../src/scenes.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

test('identity: name, image, local transport, protocols category', () => {
  assert.equal(manifest.name, 'Homebridge');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-homebridge:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-homebridge/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['protocols', 'lighting', 'climate']);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0, no more', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('config_schema: the defaults and options of the code', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(keys.sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.deepEqual(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
  assert.equal(manifest.config_schema.find((f) => f.key === 'password').type, 'secret');
  for (const key of ['username', 'password']) {
    assert.notEqual(
      manifest.config_schema.find((f) => f.key === key).required,
      true,
      `${key}: the Homebridge UI may run without login`,
    );
  }
  for (const key of ['allow_lock_commands', 'allow_garage_door_commands', 'allow_alarm_commands']) {
    assert.equal(
      manifest.config_schema.find((f) => f.key === key).default,
      false,
      `${key}: locks, garage doors and alarms stay read-only by default`,
    );
  }
  const languages = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    languages.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(languages.default, 'fr');
});

test('number fields have integer bounds and defaults (rendered without step)', () => {
  for (const field of manifest.config_schema.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      assert.ok(Number.isInteger(field[key]), `${field.key}.${key}`);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every manifest action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake } = world;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), [...SCENE_ACTION_KEYS].sort());
  for (const action of manifest.scene_actions) {
    const ack = await fake.sceneAction(action.key, {});
    assert.doesNotMatch(ack.error ?? '', /not implemented/i, action.key);
  }
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('scene action fields are the ones the code reads', () => {
  const fields = Object.fromEntries(
    manifest.scene_actions.map((a) => [a.key, keysOf(a.fields).sort()]),
  );
  assert.deepEqual(fields, {
    set_alarm: ['alarm', 'mode'],
    set_characteristic: ['accessory', 'characteristic', 'value'],
  });
  // Adding a required field without default to a published action breaks every scene using it.
  for (const action of manifest.scene_actions) {
    const required = action.fields.filter((f) => f.required).map((f) => f.key);
    assert.ok(required.length <= 1, `${action.key}: one required field at most`);
  }
});

test('the scene triggers are declared with the filters and variables the bridge sends', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const sent = {
    button_pressed: ['accessory', 'button', 'press'],
    alarm_changed: ['accessory', 'state', 'previous_state'],
  };
  for (const trigger of manifest.scene_triggers) {
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(sent[trigger.key].includes(key), `${trigger.key}: "${key}" is sent`);
    }
    for (const field of trigger.fields) {
      assert.ok(['string', 'select', 'multi_select'].includes(field.type), field.key);
    }
  }
  const options = (key, field) =>
    manifest.scene_triggers
      .find((t) => t.key === key)
      .fields.find((f) => f.key === field)
      .options.map((o) => o.value);
  assert.deepEqual(options('button_pressed', 'press'), Object.values(PRESSES));
  assert.deepEqual(options('alarm_changed', 'state').sort(), Object.values(ALARM_STATES).sort());
  const modes = manifest.scene_actions
    .find((a) => a.key === 'set_alarm')
    .fields.find((f) => f.key === 'mode')
    .options.map((o) => o.value);
  assert.deepEqual(modes, Object.keys(ALARM_TARGETS));
});
