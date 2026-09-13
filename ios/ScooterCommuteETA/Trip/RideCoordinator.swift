import CoreLocation
import Foundation
import Observation
import OSLog
import UIKit

/// The state machine that turns raw location/motion events into clean, complete
/// trips. It is the single owner of a live trip.
///
/// Detection follows the spec:
///   * geofence exit (or manual start) begins *arming*;
///   * the trip is confirmed once activity reads cycling/automotive at
///     medium+ confidence (manual start confirms immediately);
///   * it ends on geofence entry at the other endpoint, or after 120 s
///     continuously stationary, or on manual stop;
///   * trips under 300 m or 90 s are discarded as noise.
@MainActor
@Observable
final class RideCoordinator {
    enum Phase: Equatable {
        case idle
        case arming      // started, waiting for a ride-like activity classification
        case recording   // confirmed live trip
    }

    // Observable state for the UI.
    private(set) var phase: Phase = .idle
    private(set) var liveDistanceM: Double = 0
    private(set) var liveStartedAt: Date?

    // Tunables (also referenced by the spec's battery note).
    private let movingSpeedThreshold: Double = 0.7      // m/s
    private let stationaryEndSeconds: TimeInterval = 120
    private let armingDeadlineSeconds: TimeInterval = 180
    private let minTripDistanceM: Double = 300
    private let minTripDurationS: TimeInterval = 90
    private let elevationNoiseGateM: Double = 1.0
    private let flushInterval: TimeInterval = 15

    private let repository: TripRepository
    private let settings: AppSettings
    private let location: LocationService
    private let motion: MotionService
    private let weather: WeatherService
    private let log = Logger(subsystem: "ScooterCommuteETA", category: "ride")

    // Live-trip working state.
    private var trip: Trip?
    private var startTrigger: TripTrigger = .geofence
    private var originRegionId: String?
    private var confirmed = false
    private var lastFix: LocationFix?
    private var lastAltitude: Double?
    private var elevationGainM: Double = 0
    private var movingTimeS: TimeInterval = 0
    private var stoppedTimeS: TimeInterval = 0

    // Pre-trip raw buffers: samples that arrive before the trip row exists (its
    // creation is async) wait here and are drained once it does.
    private var pendingFixes: [LocationFix] = []
    private var pendingMotion: [RawMotionSample] = []
    private var pendingAltitude: [RawAltitudeSample] = []
    /// Guards against spawning more than one trip-creation task.
    private var materializing = false

    // Buffers awaiting the next batched flush to SQLite.
    private var fixBuffer: [LocationFix] = []
    private var motionBuffer: [MotionSample] = []
    private var altitudeBuffer: [AltitudeSample] = []

    private var lastRideLikeAt: Date?
    private var stationarySince: Date?
    private var tickTimer: Timer?
    private var weatherTask: Task<WeatherService.Result?, Never>?
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    init(
        repository: TripRepository,
        settings: AppSettings,
        location: LocationService,
        motion: MotionService,
        weather: WeatherService = WeatherService()
    ) {
        self.repository = repository
        self.settings = settings
        self.location = location
        self.motion = motion
        self.weather = weather
        location.delegate = self
        motion.delegate = self
    }

    /// Register the geofences and begin listening. Call once endpoints are set.
    func begin() {
        guard let home = settings.home, let work = settings.work else { return }
        location.monitorEndpoints(home: home, work: work)
        motion.startActivityUpdates()
    }

    // MARK: - Manual override

    func startManualTrip() {
        guard phase == .idle else { return }
        beginTrip(trigger: .manual)
        confirmed = true
        phase = .recording
    }

    func stopManualTrip() {
        guard phase != .idle else { return }
        Task { await endTrip(trigger: .manual) }
    }

    // MARK: - Trip lifecycle

    private func beginTrip(trigger: TripTrigger, originRegionId: String? = nil) {
        log.info("Begin trip, trigger=\(trigger.rawValue, privacy: .public)")
        self.startTrigger = trigger
        self.originRegionId = originRegionId
        self.confirmed = false
        self.trip = nil
        self.lastFix = nil
        self.lastAltitude = nil
        self.elevationGainM = 0
        self.movingTimeS = 0
        self.stoppedTimeS = 0
        self.liveDistanceM = 0
        self.liveStartedAt = Date()
        self.stationarySince = nil
        self.lastRideLikeAt = nil
        self.materializing = false
        pendingFixes.removeAll()
        pendingMotion.removeAll()
        pendingAltitude.removeAll()
        fixBuffer.removeAll()
        motionBuffer.removeAll()
        altitudeBuffer.removeAll()

        phase = .arming
        beginBackgroundTask()
        location.startHighRateUpdates()
        motion.startMotion()
        startTicking()
    }

    /// Create the trip row from the first good fix, then drain pre-trip buffers.
    /// Runs at most once per trip (guarded by `materializing`); the only
    /// suspension point is the insert, and no fixes can interleave between
    /// assigning `trip` and draining because that tail is synchronous.
    private func materializeTrip() async {
        guard let firstFix = pendingFixes.first else { materializing = false; return }
        let started = firstFix.timestamp
        let cal = Calendar.vilnius
        var newTrip = Trip(
            id: nil,
            startedAt: started,
            endedAt: nil,
            startLat: firstFix.lat,
            startLon: firstFix.lon,
            endLat: nil,
            endLon: nil,
            distanceM: 0,
            movingTimeS: 0,
            stoppedTimeS: 0,
            startTrigger: startTrigger,
            endTrigger: nil,
            weatherJson: nil,
            weatherMissing: false,
            headwindComponentMS: nil,
            elevationGainM: nil,
            isDark: SolarCalculator.isDark(at: started, coordinate: firstFix.coordinate),
            dayOfWeek: cal.component(.weekday, from: started),
            isHoliday: Holidays.isHoliday(started, calendar: cal),
            tag: nil,
            excluded: false,
            exclusionReason: nil,
            routeClusterId: nil
        )
        do {
            newTrip = try await repository.createTrip(newTrip)
            let tripId = newTrip.id!
            // The trip may have ended while the insert was in flight; if so,
            // discard the orphan row rather than leaving it unfinalized.
            guard phase != .idle else {
                try? await repository.deleteTrip(id: tripId)
                materializing = false
                return
            }
            self.trip = newTrip
            // Kick off the weather fetch now that we have a start coordinate.
            let coord = firstFix.coordinate
            weatherTask = Task { await weather.snapshot(at: coord) }

            // Drain the fixes that arrived before the row existed, accumulating
            // distance/time through them in order.
            let bufferedFixes = pendingFixes
            pendingFixes.removeAll()
            for pf in bufferedFixes {
                accumulate(fix: pf)
                fixBuffer.append(LocationFix(
                    id: nil, tripId: tripId, timestamp: pf.timestamp,
                    lat: pf.lat, lon: pf.lon, altitude: pf.altitude,
                    horizontalAccuracy: pf.horizontalAccuracy,
                    speed: pf.speed, course: pf.course
                ))
            }
            drainPendingSamples(into: tripId)
        } catch {
            log.error("Failed to create trip row: \(error.localizedDescription, privacy: .public)")
        }
        materializing = false
    }

    private func drainPendingSamples(into tripId: Int64) {
        for m in pendingMotion {
            motionBuffer.append(MotionSample(
                id: nil, tripId: tripId, timestamp: m.timestamp,
                accelX: m.x, accelY: m.y, accelZ: m.z, userAccelMagnitude: m.magnitude
            ))
        }
        for a in pendingAltitude {
            appendAltitude(a, tripId: tripId)
        }
        pendingMotion.removeAll()
        pendingAltitude.removeAll()
    }

    private func endTrip(trigger: TripTrigger) async {
        guard phase != .idle else { return }
        log.info("End trip, trigger=\(trigger.rawValue, privacy: .public)")
        phase = .idle
        stopTicking()
        location.stopHighRateUpdates()
        motion.stopMotion()

        guard var finished = trip else {
            // Never got a fix: nothing worth keeping.
            cleanupAfterTrip()
            return
        }

        await flushBuffers()

        finished.endedAt = lastFix?.timestamp ?? Date()
        finished.endLat = lastFix?.lat
        finished.endLon = lastFix?.lon
        finished.distanceM = liveDistanceM
        finished.movingTimeS = movingTimeS
        finished.stoppedTimeS = stoppedTimeS
        finished.elevationGainM = elevationGainM
        finished.endTrigger = trigger

        // Discard noise. Cascades delete any samples already written.
        let duration = finished.endedAt!.timeIntervalSince(finished.startedAt)
        if liveDistanceM < minTripDistanceM || duration < minTripDurationS {
            log.info("Discarding noise trip (d=\(self.liveDistanceM)m, t=\(duration)s)")
            if let id = finished.id { try? await repository.deleteTrip(id: id) }
            cleanupAfterTrip()
            return
        }

        // Attach weather + derived headwind.
        if let result = await weatherTask?.value {
            finished.weatherJson = result.rawJSON
            finished.weatherMissing = false
            if let speed = result.snapshot.windSpeed10m,
               let dir = result.snapshot.windDirection10m,
               let end = finished.endCoordinate {
                let bearing = Geo.bearing(from: finished.startCoordinate, to: end)
                finished.headwindComponentMS = Wind.headwindComponent(
                    windSpeedMS: speed, windFromDirectionDeg: dir, travelBearingDeg: bearing
                )
            }
        } else {
            finished.weatherMissing = true
        }

        do {
            try await repository.updateTrip(finished)
            let minutes = Int((duration / 60).rounded())
            await TripNotifications.promptForTag(tripId: finished.id!, durationMinutes: minutes)
        } catch {
            log.error("Failed to finalize trip: \(error.localizedDescription, privacy: .public)")
        }
        cleanupAfterTrip()
    }

    private func cleanupAfterTrip() {
        trip = nil
        lastFix = nil
        liveStartedAt = nil
        liveDistanceM = 0
        confirmed = false
        weatherTask = nil
        endBackgroundTask()
    }

    // MARK: - Periodic tick (flush + stationary/arming deadlines)

    private func startTicking() {
        stopTicking()
        let timer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                Task { await self.tick() }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        tickTimer = timer
    }

    private func stopTicking() {
        tickTimer?.invalidate()
        tickTimer = nil
    }

    private var lastFlush = Date.distantPast
    private func tick() async {
        let now = Date()

        // Arming deadline: if we never confirmed and barely moved, abort quietly.
        if phase == .arming,
           let started = liveStartedAt,
           now.timeIntervalSince(started) > armingDeadlineSeconds,
           liveDistanceM < minTripDistanceM {
            log.info("Arming deadline passed without confirmation; aborting")
            await endTrip(trigger: startTrigger == .manual ? .manual : .motion)
            return
        }

        // Stationary end: 120 continuous seconds without movement.
        if phase == .recording, let since = stationarySince,
           now.timeIntervalSince(since) >= stationaryEndSeconds {
            await endTrip(trigger: .motion)
            return
        }

        if now.timeIntervalSince(lastFlush) >= flushInterval {
            await flushBuffers()
            lastFlush = now
        }
    }

    private func flushBuffers() async {
        let fixes = fixBuffer; fixBuffer.removeAll()
        let motionSamples = motionBuffer; motionBuffer.removeAll()
        let altitudeSamples = altitudeBuffer; altitudeBuffer.removeAll()
        do {
            try await repository.insert(fixes: fixes)
            try await repository.insert(motion: motionSamples)
            try await repository.insert(altitude: altitudeSamples)
        } catch {
            log.error("Flush failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Sample handling

    private func appendAltitude(_ a: RawAltitudeSample, tripId: Int64) {
        if let last = lastAltitude {
            let delta = a.relativeAltitudeM - last
            if delta > elevationNoiseGateM {
                elevationGainM += delta
                lastAltitude = a.relativeAltitudeM
            } else if delta < -elevationNoiseGateM {
                lastAltitude = a.relativeAltitudeM
            }
        } else {
            lastAltitude = a.relativeAltitudeM
        }
        altitudeBuffer.append(AltitudeSample(
            id: nil, tripId: tripId, timestamp: a.timestamp,
            relativeAltitudeM: a.relativeAltitudeM, pressureKPA: a.pressureKPA
        ))
    }

    // MARK: - Background task (keeps us alive across the end-of-trip flush)

    private func beginBackgroundTask() {
        endBackgroundTask()
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "trip-flush") { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        if bgTask != .invalid {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
    }
}

// MARK: - LocationServiceDelegate

extension RideCoordinator: LocationServiceDelegate {
    func locationService(_ s: LocationService, didUpdate locations: [CLLocation]) {
        guard phase != .idle else { return }
        for loc in locations {
            let acc = loc.horizontalAccuracy
            // Drop garbage fixes before they reach the distance calc.
            guard acc >= 0, acc <= 30 else { continue }

            let fix = LocationFix(
                id: nil,
                tripId: trip?.id ?? -1,
                timestamp: loc.timestamp,
                lat: loc.coordinate.latitude,
                lon: loc.coordinate.longitude,
                altitude: loc.altitude,
                horizontalAccuracy: acc,
                speed: loc.speed,
                course: loc.course
            )

            guard let id = trip?.id else {
                // No trip row yet: buffer the fix and kick off creation once.
                pendingFixes.append(fix)
                if !materializing {
                    materializing = true
                    Task { await materializeTrip() }
                }
                continue
            }

            accumulate(fix: fix)
            fixBuffer.append(LocationFix(
                id: nil, tripId: id, timestamp: fix.timestamp,
                lat: fix.lat, lon: fix.lon, altitude: fix.altitude,
                horizontalAccuracy: fix.horizontalAccuracy,
                speed: fix.speed, course: fix.course
            ))
        }
    }

    private func accumulate(fix: LocationFix) {
        defer { lastFix = fix }
        guard let last = lastFix else { return }
        let d = Geo.distance(from: last.coordinate, to: fix.coordinate)
        let dt = fix.timestamp.timeIntervalSince(last.timestamp)
        guard dt > 0 else { return }
        liveDistanceM += d

        let speed = fix.speed >= 0 ? fix.speed : d / dt
        // Any real forward motion counts against the stationary timer.
        if speed > movingSpeedThreshold {
            movingTimeS += dt
            stationarySince = nil
        } else {
            stoppedTimeS += dt
            if stationarySince == nil { stationarySince = fix.timestamp }
        }
    }

    func locationService(_ s: LocationService, didExitRegion id: String) {
        guard phase == .idle else { return }
        beginTrip(trigger: .geofence, originRegionId: id)
    }

    func locationService(_ s: LocationService, didEnterRegion id: String) {
        // End only when arriving at the *other* endpoint.
        guard phase == .recording, id != originRegionId else { return }
        Task { await endTrip(trigger: .geofence) }
    }

    func locationServiceDidChangeAuthorization(_ s: LocationService) { }
}

// MARK: - MotionServiceDelegate

extension RideCoordinator: MotionServiceDelegate {
    func motionService(_ s: MotionService, didUpdateActivity activity: RideActivity) {
        guard phase != .idle else { return }
        if activity.isRideLike {
            lastRideLikeAt = activity.timestamp
            stationarySince = nil
            if phase == .arming {
                confirmed = true
                phase = .recording
            }
        }
        if activity.isStationary, phase == .recording, stationarySince == nil {
            stationarySince = activity.timestamp
        }
    }

    func motionService(_ s: MotionService, didSampleMotion sample: RawMotionSample) {
        guard phase != .idle else { return }
        guard let id = trip?.id else { pendingMotion.append(sample); return }
        motionBuffer.append(MotionSample(
            id: nil, tripId: id, timestamp: sample.timestamp,
            accelX: sample.x, accelY: sample.y, accelZ: sample.z,
            userAccelMagnitude: sample.magnitude
        ))
    }

    func motionService(_ s: MotionService, didSampleAltitude sample: RawAltitudeSample) {
        guard phase != .idle else { return }
        guard let id = trip?.id else { pendingAltitude.append(sample); return }
        appendAltitude(sample, tripId: id)
    }
}
