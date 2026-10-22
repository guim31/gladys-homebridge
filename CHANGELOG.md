# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Homebridge bridge: the accessories of every Homebridge plugin offered in the
  Discovery tab through the Homebridge UI, one device per accessory, filtered
  by name.
- Lights (on/off, brightness, colour, colour temperature), switches and
  outlets, fans, purifiers, humidifiers, valves and TVs (on/off, speed),
  thermostats (set point, mode), heater-coolers (on/off, mode, set point),
  window coverings and windows (open, close, stop, position), doors, locks and
  garage doors, sensors (temperature, humidity, light, CO2, PM2.5, PM10,
  battery) and detectors (motion, occupancy, contact, leak, smoke, CO, low
  battery, tampering).
- Live values through the socket of the Homebridge UI, polling every 30
  seconds when it does not get through, and unreachable badges when Homebridge
  is down.
- Login with a user of the UI (no administrator needed), or none when the UI
  runs without login; clear messages when insecure mode is off or the login is
  refused.
- Locks, garage and motorised doors, and alarms read-only unless their family
  is allowed in the configuration.
- Scene triggers "Homebridge button pressed" and "Homebridge alarm changed",
  scene actions "Arm or disarm a Homebridge alarm" and "Set a Homebridge
  characteristic", a dashboard widget, and a connection test listing the
  services not imported.
- English, French, German and Spanish.
