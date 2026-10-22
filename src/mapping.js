// -----------------------------------------------------------------------------
// One HAP service of Homebridge -> Gladys features (pure).
//
// A service is one object of GET /api/accessories: `uniqueId`, `aid`, `iid`,
// `type` (Lightbulb, Outlet, Thermostat...), `serviceName` and
// `serviceCharacteristics` (`type`, `value`, `format`, `canWrite`,
// `minValue`, `maxValue`, `minStep`, `validValues`). `mapService` returns its
// features, each
//   role      part of the feature external id: never change it,
//   spec      category, type, unit, min, max, read_only, has_feedback,
//   read      (service) -> number | null (null: nothing to publish),
//   write     (value, service) -> [{ type, value }], the characteristics to set,
//   throttle  a measurement, spaced by the sensor interval,
// or `{ skipped: reason }` when nothing maps it, or `null` for the services
// that are never devices (accessory information, buttons, alarms: these two
// are scene triggers).
//
// Value conventions: HAP on one side (the HomeKit Accessory Protocol: booleans
// often arrive as 0/1, temperatures are always in °C, ContactSensorState is 0
// when the contact is DETECTED, i.e. closed), the Gladys core enums on the
// other (server/utils/constants.js, copied: the SDK does not export them).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

// Value enums of the Gladys core.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const AC_MODE = { AUTO: 0, COOLING: 1, HEATING: 2 };

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** The error thrown for a refused write, keyed in src/texts.js ERRORS. */
export class WriteError extends Error {
  constructor(key) {
    super(key);
    this.name = 'WriteError';
    this.key = key;
  }
}

// --- Service helpers ---------------------------------------------------------------

export const charOf = (service, type) =>
  (Array.isArray(service?.serviceCharacteristics) ? service.serviceCharacteristics : []).find(
    (c) => c?.type === type,
  );

/** A HAP value as a number: booleans (or 0/1) become 0/1; anything else null. */
export function numberOf(service, type) {
  const value = charOf(service, type)?.value;
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return finite(value) ? value : null;
}

const writable = (service, type) => charOf(service, type)?.canWrite === true;

/** HSB (degrees, %) -> 0xRRGGBB at full brightness: Gladys keeps the brightness apart. */
export function hsToInt(h, s) {
  const sat = clamp(s, 0, 100) / 100;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (1 - sat * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

/** 0xRRGGBB -> { h, s } (degrees, %). */
export function intToHs(n) {
  const rgb = clamp(Math.round(Number(n) || 0), 0, 0xffffff);
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) {
      h = 60 * (((g - b) / d) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / d + 2);
    } else {
      h = 60 * ((r - g) / d + 4);
    }
  }
  return { h: Math.round((h + 360) % 360), s: max === 0 ? 0 : Math.round((d / max) * 100) };
}

// --- Security --------------------------------------------------------------------------

/**
 * The services whose commands are a security choice, by family: each family
 * has its own switch in the configuration, off by default. A motorised Door
 * goes with the garage doors: both open the house.
 */
export const SECURITY_FAMILY = {
  LockMechanism: 'lock',
  GarageDoorOpener: 'garage',
  Door: 'garage',
  SecuritySystem: 'alarm',
};

// --- Features ----------------------------------------------------------------------

const binary = (category, type) => ({ category, type, min: 0, max: 1 });

/** On/off (On or Active), written as a boolean or 0/1 as HAP wants it. */
function power(service, charType, spec) {
  const format = charOf(service, charType)?.format;
  return {
    role: charType === 'On' ? 'on' : 'active',
    main: true,
    spec,
    read: (s) => {
      const v = numberOf(s, charType);
      return v === null ? null : v > 0 ? 1 : 0;
    },
    write: writable(service, charType)
      ? (v) => [
          { type: charType, value: format === 'bool' ? Number(v) > 0 : Number(v) > 0 ? 1 : 0 },
        ]
      : undefined,
  };
}

/** A number written within the bounds HAP gives, refused outside: never turned into another. */
function boundedWrite(service, charType, { round = false } = {}) {
  const c = charOf(service, charType);
  return (v) => {
    let value = Number(v);
    if (round) {
      value = Math.round(value);
    } else if (finite(c?.minStep) && c.minStep > 0) {
      value = Math.round(value / c.minStep) * c.minStep;
      value = Math.round(value * 1000) / 1000;
    }
    if (
      !finite(value) ||
      (finite(c?.minValue) && value < c.minValue) ||
      (finite(c?.maxValue) && value > c.maxValue)
    ) {
      throw new WriteError('out_of_range');
    }
    return [{ type: charType, value }];
  };
}

const boundsOf = (service, charType, [min, max]) => {
  const c = charOf(service, charType);
  const lo = finite(c?.minValue) ? c.minValue : min;
  const hi = finite(c?.maxValue) ? c.maxValue : max;
  return lo < hi ? [lo, hi] : [min, max];
};

/** Measurements and detectors, found in any service that carries them. */
const SENSORS = {
  CurrentTemperature: {
    role: 'temperature',
    spec: { category: C.TEMPERATURE_SENSOR, type: T.SENSOR.DECIMAL, min: -60, max: 150 },
    unit: U.CELSIUS,
  },
  CurrentRelativeHumidity: {
    role: 'humidity',
    spec: { category: C.HUMIDITY_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 100 },
    unit: U.PERCENT,
  },
  CurrentAmbientLightLevel: {
    role: 'light',
    spec: { category: C.LIGHT_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 100_000 },
    unit: U.LUX,
  },
  CarbonDioxideLevel: {
    role: 'co2',
    spec: { category: C.CO2_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 100_000 },
    unit: U.PPM,
  },
  PM2_5Density: {
    role: 'pm25',
    spec: { category: C.PM25_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 1000 },
    unit: U.MICROGRAM_PER_CUBIC_METER,
  },
  PM10Density: {
    role: 'pm10',
    spec: { category: C.PM10_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 1000 },
    unit: U.MICROGRAM_PER_CUBIC_METER,
  },
  BatteryLevel: {
    role: 'battery',
    spec: { category: C.BATTERY, type: T.BATTERY.INTEGER, min: 0, max: 100 },
    unit: U.PERCENT,
    round: true,
  },
  StatusLowBattery: { role: 'low_battery', spec: binary(C.BATTERY_LOW, T.BATTERY_LOW.BINARY) },
  MotionDetected: { role: 'motion', spec: binary(C.MOTION_SENSOR, T.SENSOR.BINARY) },
  OccupancyDetected: { role: 'occupancy', spec: binary(C.PRESENCE_SENSOR, T.SENSOR.BINARY) },
  // HAP: 0 = CONTACT_DETECTED (closed), 1 = CONTACT_NOT_DETECTED (open). Gladys: 0 = open.
  ContactSensorState: {
    role: 'contact',
    spec: binary(C.OPENING_SENSOR, T.SENSOR.BINARY),
    invert: true,
  },
  LeakDetected: { role: 'leak', spec: binary(C.LEAK_SENSOR, T.SENSOR.BINARY) },
  SmokeDetected: { role: 'smoke', spec: binary(C.SMOKE_SENSOR, T.SENSOR.BINARY) },
  CarbonMonoxideDetected: { role: 'co', spec: binary(C.CO_SENSOR, T.SENSOR.BINARY) },
  StatusTampered: { role: 'tamper', spec: binary(C.TAMPER, T.TAMPER.BINARY) },
};

/** The sensors of a service; the first one is its main feature when it has no control. */
function sensorFeatures(service) {
  const features = [];
  for (const c of service.serviceCharacteristics ?? []) {
    const def = SENSORS[c?.type];
    if (!def || features.some((f) => f.role === def.role)) {
      continue;
    }
    const isBinary = def.spec.max === 1 && def.spec.min === 0 && !def.unit;
    features.push({
      role: def.role,
      spec: { ...def.spec, ...(def.unit ? { unit: def.unit } : {}) },
      read: (s) => {
        const v = numberOf(s, c.type);
        if (v === null) {
          return null;
        }
        if (isBinary) {
          const on = v > 0 ? 1 : 0;
          return def.invert ? 1 - on : on;
        }
        return def.round ? Math.round(v) : Math.round(v * 100) / 100;
      },
      // Measurements are spaced; detectors are never delayed.
      throttle: !isBinary,
    });
  }
  return features;
}

// --- Services ----------------------------------------------------------------------

function lightbulb(service) {
  const features = [power(service, 'On', binary(C.LIGHT, T.LIGHT.BINARY))];
  if (charOf(service, 'Brightness')) {
    features.push({
      role: 'brightness',
      spec: { category: C.LIGHT, type: T.LIGHT.BRIGHTNESS, min: 0, max: 100, unit: U.PERCENT },
      read: (s) => {
        const v = numberOf(s, 'Brightness');
        return v === null ? null : clamp(Math.round(v), 0, 100);
      },
      write: writable(service, 'Brightness')
        ? (v) => [{ type: 'Brightness', value: clamp(Math.round(Number(v) || 0), 0, 100) }]
        : undefined,
    });
  }
  if (charOf(service, 'Hue') && charOf(service, 'Saturation')) {
    features.push({
      role: 'color',
      spec: { category: C.LIGHT, type: T.LIGHT.COLOR, min: 0, max: 0xffffff },
      read: (s) => {
        const h = numberOf(s, 'Hue');
        const sat = numberOf(s, 'Saturation');
        return h === null || sat === null ? null : hsToInt(h, sat);
      },
      write:
        writable(service, 'Hue') && writable(service, 'Saturation')
          ? (v) => {
              const { h, s } = intToHs(v);
              return [
                { type: 'Hue', value: h },
                { type: 'Saturation', value: s },
              ];
            }
          : undefined,
    });
  }
  if (charOf(service, 'ColorTemperature')) {
    // HAP gives the colour temperature in mireds, like Gladys.
    const [min, max] = boundsOf(service, 'ColorTemperature', [140, 500]);
    features.push({
      role: 'color_temperature',
      spec: { category: C.LIGHT, type: T.LIGHT.TEMPERATURE, min, max },
      read: (s) => {
        const v = numberOf(s, 'ColorTemperature');
        return v === null ? null : Math.round(v);
      },
      write: writable(service, 'ColorTemperature')
        ? (v) => [{ type: 'ColorTemperature', value: clamp(Math.round(Number(v) || 0), min, max) }]
        : undefined,
    });
  }
  return features;
}

const onOffSwitch = (service) => [power(service, 'On', binary(C.SWITCH, T.SWITCH.BINARY))];

/** Fans, purifiers, humidifiers, valves, TVs: their Active (or On) and their speed. */
function activeDevice(service) {
  const charType = charOf(service, 'Active') ? 'Active' : charOf(service, 'On') ? 'On' : null;
  if (!charType) {
    return [];
  }
  const features = [power(service, charType, binary(C.SWITCH, T.SWITCH.BINARY))];
  const speed = charOf(service, 'RotationSpeed');
  if (speed) {
    const [min, max] = boundsOf(service, 'RotationSpeed', [0, 100]);
    features.push({
      role: 'speed',
      spec: {
        category: C.FAN,
        type: T.FAN.PERCENT,
        min,
        max,
        ...(speed.unit === 'percentage' ? { unit: U.PERCENT } : {}),
      },
      read: (s) => {
        const v = numberOf(s, 'RotationSpeed');
        return v === null ? null : Math.round(v);
      },
      write: speed.canWrite ? boundedWrite(service, 'RotationSpeed', { round: true }) : undefined,
    });
  }
  return features;
}

function thermostat(service) {
  const features = [];
  if (charOf(service, 'TargetTemperature')) {
    const [min, max] = boundsOf(service, 'TargetTemperature', [10, 38]);
    features.push({
      role: 'target',
      main: true,
      spec: {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        min,
        max,
        unit: U.CELSIUS,
      },
      read: (s) => numberOf(s, 'TargetTemperature'),
      write: writable(service, 'TargetTemperature')
        ? boundedWrite(service, 'TargetTemperature')
        : undefined,
    });
  }
  const mode = charOf(service, 'TargetHeatingCoolingState');
  if (mode) {
    // HAP 0 OFF, 1 HEAT, 2 COOL, 3 AUTO: the THERMOSTAT_MODE values of Gladys.
    const valid = Array.isArray(mode.validValues) ? mode.validValues : [0, 1, 2, 3];
    features.push({
      role: 'mode',
      spec: { category: C.THERMOSTAT, type: T.THERMOSTAT.MODE, min: 0, max: 3 },
      read: (s) => {
        const v = numberOf(s, 'TargetHeatingCoolingState');
        return v !== null && v >= 0 && v <= 3 ? v : null;
      },
      write: mode.canWrite
        ? (v) => {
            const value = Number(v);
            if (!valid.includes(value)) {
              throw new WriteError('unsupported_value');
            }
            return [{ type: 'TargetHeatingCoolingState', value }];
          }
        : undefined,
    });
  }
  return features;
}

function heaterCooler(service) {
  const features = [
    power(service, 'Active', binary(C.AIR_CONDITIONING, T.AIR_CONDITIONING.BINARY)),
  ];
  // HAP TargetHeaterCoolerState 0 AUTO, 1 HEAT, 2 COOL <-> AC_MODE of Gladys.
  const toGladys = { 0: AC_MODE.AUTO, 1: AC_MODE.HEATING, 2: AC_MODE.COOLING };
  const toHap = { [AC_MODE.AUTO]: 0, [AC_MODE.HEATING]: 1, [AC_MODE.COOLING]: 2 };
  const mode = charOf(service, 'TargetHeaterCoolerState');
  if (mode) {
    const valid = Array.isArray(mode.validValues) ? mode.validValues : [0, 1, 2];
    features.push({
      role: 'mode',
      spec: { category: C.AIR_CONDITIONING, type: T.AIR_CONDITIONING.MODE, min: 0, max: 4 },
      read: (s) => toGladys[numberOf(s, 'TargetHeaterCoolerState')] ?? null,
      write: mode.canWrite
        ? (v) => {
            const value = toHap[Number(v)];
            if (value === undefined || !valid.includes(value)) {
              throw new WriteError('unsupported_value');
            }
            return [{ type: 'TargetHeaterCoolerState', value }];
          }
        : undefined,
    });
  }
  const heat = charOf(service, 'HeatingThresholdTemperature');
  const cool = charOf(service, 'CoolingThresholdTemperature');
  if (mode && (heat || cool)) {
    // The set point of the current mode: heating or cooling threshold (none in AUTO).
    const thresholdOf = (s) => {
      const m = numberOf(s, 'TargetHeaterCoolerState');
      return m === 1 && heat
        ? 'HeatingThresholdTemperature'
        : m === 2 && cool
          ? 'CoolingThresholdTemperature'
          : null;
    };
    const bounds = [heat, cool].filter(Boolean).map((c) => boundsOf(service, c.type, [10, 35]));
    const min = Math.min(...bounds.map((b) => b[0]));
    const max = Math.max(...bounds.map((b) => b[1]));
    features.push({
      role: 'target',
      spec: {
        category: C.AIR_CONDITIONING,
        type: T.AIR_CONDITIONING.TARGET_TEMPERATURE,
        min,
        max,
        unit: U.CELSIUS,
      },
      read: (s) => {
        const type = thresholdOf(s);
        return type ? numberOf(s, type) : null;
      },
      write: (v, s) => {
        const type = thresholdOf(s);
        if (!type || !writable(s, type)) {
          throw new WriteError('unsupported_value');
        }
        return boundedWrite(s, type)(v);
      },
    });
  }
  return features;
}

/** WindowCovering, Window, Door: positions 0 (closed) to 100 (open), like Gladys. */
function positioned(category, types, { sensitive = false } = {}) {
  return (service, ctx) => {
    const controllable = !sensitive || ctx.allowed;
    const features = [];
    const target = writable(service, 'TargetPosition') && controllable;
    if (target) {
      const hold = writable(service, 'HoldPosition');
      features.push({
        role: 'state',
        main: true,
        spec: { category, type: types.STATE, min: -1, max: 1 },
        write: (v) => {
          const value = Number(v);
          if (value === COVER_STATE.OPEN) {
            return [{ type: 'TargetPosition', value: 100 }];
          }
          if (value === COVER_STATE.CLOSE) {
            return [{ type: 'TargetPosition', value: 0 }];
          }
          if (value === COVER_STATE.STOP && hold) {
            return [{ type: 'HoldPosition', value: true }];
          }
          throw new WriteError('unsupported_value');
        },
      });
    }
    if (charOf(service, 'CurrentPosition')) {
      features.push({
        role: 'position',
        main: !target,
        spec: { category, type: types.POSITION, min: 0, max: 100, unit: U.PERCENT },
        read: (s) => {
          const v = numberOf(s, 'CurrentPosition');
          return v === null ? null : clamp(Math.round(v), 0, 100);
        },
        write: target
          ? (v) => [{ type: 'TargetPosition', value: clamp(Math.round(Number(v) || 0), 0, 100) }]
          : undefined,
      });
      if (sensitive) {
        // Always readable, even when the commands are off: open or closed.
        features.push({
          role: 'contact',
          spec: binary(C.OPENING_SENSOR, T.SENSOR.BINARY),
          read: (s) => {
            const v = numberOf(s, 'CurrentPosition');
            return v === null
              ? null
              : v > 0
                ? OPENING_SENSOR_STATE.OPEN
                : OPENING_SENSOR_STATE.CLOSE;
          },
        });
      }
    }
    return features;
  };
}

function lockMechanism(service, ctx) {
  return [
    {
      role: 'state',
      main: true,
      spec: binary(C.LOCK, T.LOCK.BINARY),
      // HAP 0 UNSECURED, 1 SECURED, 2 JAMMED, 3 UNKNOWN; Gladys 0 unlocked, 1 locked.
      read: (s) => {
        const v = numberOf(s, 'LockCurrentState');
        return v === 0 || v === 1 ? v : null;
      },
      write:
        ctx.allowed && writable(service, 'LockTargetState')
          ? (v) => [{ type: 'LockTargetState', value: Number(v) > 0 ? 1 : 0 }]
          : undefined,
    },
  ];
}

function garageDoor(service, ctx) {
  const features = [];
  if (ctx.allowed && writable(service, 'TargetDoorState')) {
    features.push({
      role: 'command',
      main: true,
      spec: { category: C.SHUTTER, type: T.SHUTTER.STATE, min: -1, max: 1 },
      // HAP TargetDoorState 0 OPEN, 1 CLOSED.
      write: (v) => {
        const value = Number(v);
        if (value === COVER_STATE.OPEN) {
          return [{ type: 'TargetDoorState', value: 0 }];
        }
        if (value === COVER_STATE.CLOSE) {
          return [{ type: 'TargetDoorState', value: 1 }];
        }
        throw new WriteError('unsupported_value');
      },
    });
  }
  features.push({
    role: 'contact',
    main: features.length === 0,
    spec: binary(C.OPENING_SENSOR, T.SENSOR.BINARY),
    // HAP CurrentDoorState 0 OPEN, 1 CLOSED, 2 OPENING, 3 CLOSING, 4 STOPPED: closed only at 1.
    read: (s) => {
      const v = numberOf(s, 'CurrentDoorState');
      return v === null ? null : v === 1 ? OPENING_SENSOR_STATE.CLOSE : OPENING_SENSOR_STATE.OPEN;
    },
  });
  return features;
}

const SERVICES = {
  Lightbulb: lightbulb,
  Switch: onOffSwitch,
  Outlet: onOffSwitch,
  Fan: activeDevice,
  Fanv2: activeDevice,
  AirPurifier: activeDevice,
  HumidifierDehumidifier: activeDevice,
  Valve: activeDevice,
  Faucet: activeDevice,
  IrrigationSystem: activeDevice,
  Television: activeDevice,
  Thermostat: thermostat,
  HeaterCooler: heaterCooler,
  WindowCovering: positioned(C.SHUTTER, T.SHUTTER),
  Window: positioned(C.SHUTTER, T.SHUTTER),
  Door: positioned(C.SHUTTER, T.SHUTTER, { sensitive: true }),
  LockMechanism: lockMechanism,
  GarageDoorOpener: garageDoor,
};

/** Never devices: descriptions of the accessory, or scene triggers (buttons, alarms). */
export const SILENT_SERVICES = new Set([
  'AccessoryInformation',
  'ProtocolInformation',
  'InputSource',
  'StatelessProgrammableSwitch',
  'Doorbell',
  'SecuritySystem',
  'ServiceLabel',
]);

/**
 * @param {object} service one service of GET /api/accessories
 * @param {object} [options]
 * @param {{ lock?: boolean, garage?: boolean, alarm?: boolean }} [options.allow] security families allowed
 * @returns {Array<object> | { skipped: string } | null}
 */
export function mapService(service, { allow = {} } = {}) {
  const type = String(service?.type ?? '');
  if (SILENT_SERVICES.has(type)) {
    return null;
  }
  const family = SECURITY_FAMILY[type];
  const allowed = family ? allow[family] === true : true;
  const build = SERVICES[type];
  const controls = build ? build(service, { allowed }) : [];
  // A sensor met in a control service (the current temperature of a thermostat) comes along.
  const taken = new Set(controls.map((f) => f.role));
  const sensors = sensorFeatures(service).filter((f) => !taken.has(f.role));
  const features = [...controls, ...sensors];
  if (features.length === 0) {
    return { skipped: type || 'unknown' };
  }
  if (!features.some((f) => f.main)) {
    features[0].main = true;
  }
  return features.map((f) => {
    const canWrite = typeof f.write === 'function';
    return {
      ...f,
      write: canWrite ? f.write : undefined,
      spec: {
        keep_history: true,
        ...f.spec,
        read_only: !canWrite,
        has_feedback: canWrite && typeof f.read === 'function',
      },
    };
  });
}
