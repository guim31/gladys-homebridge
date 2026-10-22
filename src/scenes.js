// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`):
//   set_alarm           arm or disarm a security system of Homebridge (Gladys
//                       has no device for it), only when the alarm commands
//                       are allowed in the configuration;
//   set_characteristic  set any writable characteristic of any accessory, even
//                       one not added to Gladys (a TV input, a fan swing...).
// Accessories are named by the scene author: the scene editor can only list
// Gladys devices. The security switches of the configuration apply to both: a
// scene is not a way around them.
// -----------------------------------------------------------------------------

import { SECURITY_FAMILY } from './mapping.js';

/** set_alarm `mode` -> HAP SecuritySystemTargetState. */
export const ALARM_TARGETS = { home: 0, away: 1, night: 2, disarm: 3 };

/** "true", "off", "21.5", "HDMI 1" -> what the UI accepts for the characteristic. */
export function parseValue(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return undefined;
  }
  if (/^(true|on)$/i.test(text)) {
    return true;
  }
  if (/^(false|off)$/i.test(text)) {
    return false;
  }
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : text;
}

/** Refuses a command to a lock, a garage door or an alarm the configuration keeps read-only. */
export function guard(bridge, service) {
  const family = SECURITY_FAMILY[service.type];
  if (family && bridge.config.allow[family] !== true) {
    throw bridge.error('security_disabled');
  }
}

export function sceneActions(bridge) {
  return {
    async set_alarm(fields) {
      const target = ALARM_TARGETS[fields.mode];
      if (target === undefined) {
        throw bridge.error('unsupported_value');
      }
      if (bridge.config.allow.alarm !== true) {
        throw bridge.error('security_disabled');
      }
      const isAlarm = (s) => s.type === 'SecuritySystem';
      const name = String(fields.alarm ?? '').trim();
      const services = name
        ? bridge.findServices(name, isAlarm)
        : [...bridge.services.values()].filter(isAlarm);
      if (services.length === 0) {
        throw bridge.error('no_alarm');
      }
      if (services.length > 1) {
        throw bridge.error('ambiguous', name || services[0].serviceName);
      }
      const [service] = services;
      const valid = bridge.charOf(service, 'SecuritySystemTargetState')?.validValues;
      if (Array.isArray(valid) && !valid.includes(target)) {
        throw bridge.error('unsupported_value');
      }
      bridge.logger.info(`Scene action: alarm ${fields.mode} on ${service.serviceName}`);
      await bridge.write(service.uniqueId, [{ type: 'SecuritySystemTargetState', value: target }]);
    },

    async set_characteristic(fields) {
      const name = String(fields.accessory ?? '').trim();
      if (name === '' || name.length > 200) {
        throw bridge.error('bad_accessory');
      }
      const type = String(fields.characteristic ?? '').trim();
      const value = parseValue(fields.value);
      if (value === undefined || String(fields.value).length > 1000) {
        throw bridge.error('bad_value');
      }
      const services = bridge.findServices(name);
      if (services.length === 0) {
        throw bridge.error('not_found', name);
      }
      const candidates = services.filter((s) => bridge.charOf(s, type)?.canWrite === true);
      if (candidates.length === 0) {
        throw bridge.error('bad_characteristic');
      }
      if (candidates.length > 1) {
        throw bridge.error('ambiguous', name);
      }
      const [service] = candidates;
      guard(bridge, service);
      bridge.logger.info(`Scene action: ${type}=${String(value).slice(0, 40)} to ${name}`);
      await bridge.write(service.uniqueId, [{ type, value }]);
    },
  };
}

export const SCENE_ACTION_KEYS = ['set_alarm', 'set_characteristic'];
