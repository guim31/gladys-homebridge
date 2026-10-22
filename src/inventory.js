// -----------------------------------------------------------------------------
// Homebridge services -> Gladys devices and routing tables (pure).
//
// GET /api/accessories lists HAP services; the services of one accessory
// share its bridge (`instance.username`, the MAC-like id of the main or child
// bridge) and its `aid`. One Gladys device per accessory, holding the
// features of its services. Homebridge keeps aid and iid in its identifier
// cache, so they survive restarts and renames:
//   device   ext:<selector>:accessory:<bridge username without colons>-<aid>
//   feature  <device id>:<service iid>-<role>
// The commands go to the service `uniqueId` the UI computes from the same
// four values (bridge, aid, iid, type).
//
// Selection (configuration): accessory names to include, names to exclude.
// -----------------------------------------------------------------------------

import { matcher } from './config.js';
import { SECURITY_FAMILY, mapService } from './mapping.js';
import { ROLE_NAMES } from './texts.js';

const cut = (text, max = 100) => String(text ?? '').slice(0, max);

/** The accessory a service belongs to: its bridge and aid. */
export function accessoryKey(service) {
  const bridge = String(service?.instance?.username ?? service?.instance?.name ?? 'bridge');
  return `${bridge.replace(/[^A-Za-z0-9]/g, '')}-${service?.aid}`;
}

export const accessoryName = (service) =>
  String(service?.accessoryInformation?.Name || service?.serviceName || '').trim();

/**
 * @param {object[]} services GET /api/accessories
 * @param {object} options the normalized configuration (src/config.js) + { externalIds }
 */
export function buildInventory(services, options) {
  const { externalIds, language = 'fr' } = options;
  const list = Array.isArray(services)
    ? services.filter((s) => typeof s?.uniqueId === 'string' && Number.isFinite(s?.aid))
    : [];
  const included = matcher(options.include ?? []);
  const excluded = matcher(options.exclude ?? []);
  const hasInclude = (options.include ?? []).length > 0;
  const roles = ROLE_NAMES[language] ?? ROLE_NAMES.en;

  /** device external id -> { device, names } */
  const devices = new Map();
  /** service uniqueId -> [{ featureId, read, throttle }] */
  const routes = new Map();
  /** feature external id -> { uniqueId, write } */
  const writers = new Map();
  /** feature external id -> service uniqueId, read-only features included */
  const featureService = new Map();
  /** service uniqueId -> device external id */
  const serviceDevice = new Map();
  /** service uniqueId -> security family (lock, garage, alarm) */
  const security = new Map();
  const ignored = new Map();
  let serviceCount = 0;

  for (const service of list) {
    const family = SECURITY_FAMILY[service.type];
    if (family) {
      security.set(service.uniqueId, family);
    }
    const name = accessoryName(service);
    const serviceName = String(service.serviceName || name).trim();
    if (excluded(name, serviceName) || (hasInclude && !included(name, serviceName))) {
      continue;
    }
    const features = mapService(service, { allow: options.allow });
    if (features === null) {
      continue;
    }
    if (!Array.isArray(features)) {
      ignored.set(features.skipped, (ignored.get(features.skipped) ?? 0) + 1);
      continue;
    }

    const ids = externalIds('accessory', accessoryKey(service));
    let entry = devices.get(ids.device);
    if (!entry) {
      const bridge = String(service.instance?.name ?? '').trim();
      entry = {
        names: new Set(),
        device: {
          name: cut(name || serviceName),
          external_id: ids.device,
          should_poll: false,
          features: [],
          params: [
            { name: 'homebridge_accessory', value: cut(name || serviceName, 255) },
            ...(bridge ? [{ name: 'homebridge_bridge', value: cut(bridge, 255) }] : []),
          ],
        },
      };
      devices.set(ids.device, entry);
    }
    serviceCount += 1;
    serviceDevice.set(service.uniqueId, ids.device);
    for (const f of features) {
      const featureId = ids.feature(`${service.iid}-${f.role}`);
      let featureName = f.main ? serviceName : `${serviceName} – ${roles[f.role] ?? f.role}`;
      if (entry.names.has(featureName)) {
        featureName = `${featureName} (${service.iid})`;
      }
      entry.names.add(featureName);
      entry.device.features.push({ name: cut(featureName), external_id: featureId, ...f.spec });
      featureService.set(featureId, service.uniqueId);
      if (f.read) {
        const serviceRoutes = routes.get(service.uniqueId) ?? [];
        serviceRoutes.push({ featureId, read: f.read, throttle: Boolean(f.throttle) });
        routes.set(service.uniqueId, serviceRoutes);
      }
      if (f.write) {
        writers.set(featureId, { uniqueId: service.uniqueId, write: f.write });
      }
    }
  }

  return {
    devices: [...devices.values()].map((e) => e.device),
    routes,
    writers,
    featureService,
    serviceDevice,
    serviceCount,
    security,
    ignored: [...ignored.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
