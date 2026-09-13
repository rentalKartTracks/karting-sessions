# Scooter Commute ETA — iOS

A personal, on-device iOS app that logs an electric-scooter commute so it can
eventually learn how long the ride really takes. Single user, no accounts, no
server. Built for personal provisioning, not the App Store.

> **Status: Phase 1 (the logger) is complete.**
> Per the build spec, Phases 2 (route clustering + model) and 3 (predictions +
> audio) are intentionally **not** built yet — they should not start until the
> logger has collected at least three weeks of real trips. The schema already
> carries the seams for them (e.g. `trips.route_cluster_id`, left null).

## What Phase 1 does

- **Automatic trip detection** — 150 m geofences around home and work; a region
  exit wakes the app, motion activity (`cycling`/`automotive`) confirms a live
  ride, and the trip ends on arrival at the other endpoint or after 120 s
  stationary. Trips under 300 m / 90 s are discarded as noise. A manual
  start/stop override is always available for when detection misfires.
- **High-fidelity recording** — GPS fixes at ~1 Hz (garbage fixes over 30 m
  accuracy dropped), accelerometer at 50 Hz downsampled to 5 Hz, and
  barometric altitude at ~1 Hz. Every sample is written to SQLite.
- **Weather snapshot** at departure from Open-Meteo (no key, coarsened to ~1 km
  for privacy), stored raw, plus a derived **headwind component** projected onto
  the trip bearing. Weather never blocks recording — if the network is down the
  trip is still logged and marked.
- **Context features** per trip: `is_dark` (computed from Vilnius sunrise/
  sunset), day of week, Lithuanian public holidays, elevation gain.
- **Outlier tagger** — after each ride a notification asks "anything unusual?".
  Tagging *Stopped* or *Detour* excludes the trip; other tags stay in as
  features. Trips are never deleted by tagging.
- **Retention** — raw fixes/motion/altitude are pruned after 90 days; the
  per-trip summary row is kept forever.
- **Export** — a "dump everything to JSON" button from day one, for prototyping
  the model outside the app.

## Building

The project is defined with [XcodeGen](https://github.com/yonaskolb/XcodeGen)
so the `.xcodeproj` never has to be hand-edited or committed.

```sh
brew install xcodegen        # once
cd ios
xcodegen generate            # writes ScooterCommuteETA.xcodeproj
open ScooterCommuteETA.xcodeproj
```

Then in Xcode: select your personal team under **Signing & Capabilities**,
pick a device (Core Location background + barometer need a real iPhone, not the
simulator), and run.

- **Deployment target:** iOS 17
- **Language:** Swift 6 (strict concurrency)
- **Storage:** [GRDB.swift](https://github.com/groue/GRDB.swift) 7.x, resolved
  automatically via Swift Package Manager.

### Tests

```sh
xcodegen generate
xcodebuild test -scheme ScooterCommuteETA -destination 'platform=iOS Simulator,name=iPhone 15'
```

The unit tests cover the pure logic that must be correct for the data to be
trustworthy: great-circle distance/bearing, the headwind projection (including
its sign), sunrise/sunset darkness, Lithuanian holidays, and the repository's
tagging / retention / stats rules.

## Layout

```
ScooterCommuteETA/
  App/          entry point, dependency container, router, launch wiring
  Storage/      GRDB database, migrations, models, repository
  Location/     CLLocationManager wrapper (geofences + full-rate updates)
  Motion/       activity classification, accelerometer, altimeter
  Weather/      Open-Meteo fetch, snapshot parsing, headwind, glyphs
  Solar/        sunrise/sunset (is_dark)
  Trip/         RideCoordinator — the trip detection state machine
  Notifications/ post-trip tagger prompt
  Export/       JSON dump
  Util/         geo, wind, holidays, formatters
  UI/           onboarding, trip list, trip detail, tagger, stats
```

## Privacy

All data stays on device. The only network calls are to Open-Meteo (weather),
and both latitude and longitude are rounded to two decimal places (~1 km)
before any request leaves the phone. No analytics, no third-party SDKs. The
background-location indicator is deliberately left visible.

## Notes for the next phases

- Route clustering, surface tags (OSM/Overpass), and the OLS multiplier model
  belong in Phase 2, gated on ≥15 trips per bucket before any number is shown.
- Leave-now notifications, route-choice prediction, and the `AVSpeechSynthesizer`
  audio layer belong in Phase 3.
- Measure battery before doing any of it: `MotionService.useReducedRate()`
  drops capture to 25 Hz / longer GPS intervals if a 25-minute ride costs more
  than ~4%.
