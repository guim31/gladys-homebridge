# gladys-homebridge

[Gladys Assistant](https://gladysassistant.com) external integration that
bridges **Homebridge**: the accessories of every Homebridge plugin become Gladys
devices, their values follow Homebridge live, and Gladys controls them through
the Homebridge UI. Local only. Not affiliated with the Homebridge project nor
with Apple.

The Gladys core already has a HomeKit integration that goes the other way
(Gladys devices exposed to Apple Home); this one brings Homebridge accessories
**into** Gladys.

> Developed without the hardware: tested against a real Homebridge 2.4.0 and
> Homebridge UI 5.29.0 in Docker with the virtual accessories of
> [homebridge-dummy](https://github.com/mpatfield/homebridge-dummy). Feedback
> from real installations is welcome.

## What it does

- **Discovery**: one Gladys device per Homebridge accessory, holding the
  features of all its services. Filters by accessory name (include, exclude,
  `*` wildcards).
- **Services**: lights (on/off, brightness, colour, colour temperature),
  switches and outlets, fans, purifiers, humidifiers, valves, TVs (on/off,
  speed), thermostats (set point, mode), heater-coolers (on/off, mode, set
  point), window coverings and windows (open/close/stop, position), doors,
  locks and garage doors, sensors (temperature, humidity, light, CO2, PM2.5,
  PM10, battery) and detectors (motion, occupancy, contact, leak, smoke, CO,
  low battery, tampering).
- **Live values** through the Socket.IO namespace `/accessories` of the UI,
  with a watchdog on its pings, and polling every 30 s when the socket does not
  get through.
- **Safety**: locks, garage and motorised doors, and alarms are read-only
  unless their family is allowed in the configuration; scenes cannot get
  around it.
- **Scene triggers** "button pressed" (programmable switches, doorbells) and
  "alarm changed" (security systems), **scene actions** "arm or disarm an
  alarm" and "set a characteristic" (any writable characteristic of any
  accessory), a **dashboard widget** with the connection, the live state and a
  reload button, and a **connection test** listing what was not imported.
- Four languages (English, French, German, Spanish).

## Requirements

- Gladys Assistant 5.1.0 or later.
- Homebridge with the Homebridge UI (homebridge-config-ui-x 5.x) reachable from
  the Gladys machine, running in **insecure mode** (Homebridge settings →
  Homebridge Insecure Mode), and a UI user without two-factor authentication
  (no administrator needed), or a UI without login.

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-homebridge`. Then follow the
[documentation](docs/en.md).

## How it works

- `POST /api/auth/login` (or `/api/auth/noauth`) gives a token, renewed before
  it expires (8 h by default) and on a 401.
- `GET /api/accessories` lists every HAP service of every bridge (main and
  child bridges) with its characteristics and values; the inventory is built
  from it (`src/inventory.js`, `src/mapping.js`).
- The Socket.IO namespace `/accessories` (spoken by hand over the WebSocket of
  Node: no dependency) sends the whole list, then each changed service.
- Commands are `PUT /api/accessories/{uniqueId}` with `{ characteristicType,
value }`; the answer is the service read back, the feedback.
- External ids: `accessory:<bridge username>-<aid>` for devices,
  `<service iid>-<role>` for features. Homebridge keeps aid and iid in its
  identifier cache: renaming an accessory keeps them.
- Values are sent only for the devices added in Gladys, only when they change
  (12 h heartbeat), within the 300 states per minute of the core.

Pitfalls met on the real Homebridge (see `CLAUDE.md`): booleans arrive as
`0`/`1`; the UI checks the bounds of unsigned integers and floats only, so a
`Brightness` of 400 (an `int`) reaches the accessory, which ignores it: the
bridge refuses out-of-range values itself; `ContactSensorState` is 0 when the
contact is detected (closed).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/homebridge/accessories-2.4.0.json` is the accessory list of a
real Homebridge 2.4.0 (Docker image `homebridge/homebridge`) running
homebridge-dummy 2.1.3; addresses are replaced by documentation ones.
`test/helpers/fakeHomebridge.js` serves it through an injected `fetch` and
`WebSocket`, with a few services built from the HAP specification (colour bulb,
security system, battery, heater-cooler, fan, TV, doorbell);
`test/gladys-rules.test.js` checks every device against the feature table of
the Gladys core.

## Credits

- [Homebridge](https://homebridge.io) and
  [homebridge-config-ui-x](https://github.com/homebridge/homebridge-config-ui-x)
  (MIT): the REST API and the Socket.IO gateway this bridge talks to;
  [hap-client](https://github.com/homebridge/hap-client) (MIT) for how
  `uniqueId` is computed.
- [homebridge-dummy](https://github.com/mpatfield/homebridge-dummy) (Apache-2.0)
  for the test accessories.
- Cover: the official Homebridge logo, unmodified, from
  [homebridge/branding](https://github.com/homebridge/branding) (Apache-2.0),
  used as its guidelines allow, to show that this integration works with
  Homebridge.
- The architecture follows the other bridges of this series
  ([gladys-openhab](https://github.com/guim31/gladys-openhab),
  [gladys-homeassistant](https://github.com/guim31/gladys-homeassistant)); the
  state publisher is adapted from
  [LM1LC3N7/gladys-homey](https://github.com/LM1LC3N7/gladys-homey)
  (Apache-2.0).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0. Homebridge is a trademark of its authors; HomeKit is a trademark of
Apple Inc. This project is not affiliated with either.
