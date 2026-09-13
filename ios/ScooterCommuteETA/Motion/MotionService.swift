import CoreMotion
import Foundation
import OSLog

/// Wraps the three Core Motion sources we need:
///   * `CMMotionActivityManager` — to classify the ride (cycling/automotive)
///     and detect when it has gone stationary.
///   * `CMMotionManager` device motion at 50 Hz — accelerometer, downsampled to
///     5 Hz, gravity already removed (`userAcceleration`).
///   * `CMAltimeter` — barometric relative altitude at ~1 Hz.
///
/// Callbacks are marshalled to the main actor so the coordinator sees a single
/// consistent thread.
@MainActor
protocol MotionServiceDelegate: AnyObject {
    func motionService(_ s: MotionService, didUpdateActivity activity: RideActivity)
    func motionService(_ s: MotionService, didSampleMotion sample: RawMotionSample)
    func motionService(_ s: MotionService, didSampleAltitude sample: RawAltitudeSample)
}

/// Classified activity, reduced to what trip detection cares about.
struct RideActivity: Sendable {
    var isRideLike: Bool     // cycling or automotive, confidence >= medium
    var isStationary: Bool   // stationary, confidence >= medium
    var timestamp: Date
}

struct RawMotionSample: Sendable {
    var timestamp: Date
    var x: Double
    var y: Double
    var z: Double
    var magnitude: Double
}

struct RawAltitudeSample: Sendable {
    var timestamp: Date
    var relativeAltitudeM: Double
    var pressureKPA: Double
}

@MainActor
final class MotionService {
    /// Whether the device can classify motion activity at all.
    static var activityAvailable: Bool { CMMotionActivityManager.isActivityAvailable() }
    static var altimeterAvailable: Bool { CMAltimeter.isRelativeAltitudeAvailable() }

    private let activityManager = CMMotionActivityManager()
    private let motionManager = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let queue = OperationQueue()
    private let log = Logger(subsystem: "ScooterCommuteETA", category: "motion")

    /// 50 Hz capture, kept 1-in-10 to land at ~5 Hz on disk. Reduced to 25 Hz
    /// (keep 1-in-5) if the battery budget demands it — see `useReducedRate()`.
    private var deviceMotionRateHz: Double = 50
    private var keepEvery = 10

    /// Counts samples on the serial capture queue only. Kept out of the main
    /// actor so the 50 Hz closure never has to hop actors just to count.
    private final class Downsampler: @unchecked Sendable {
        private let keepEvery: Int
        private var counter = 0
        init(keepEvery: Int) { self.keepEvery = keepEvery }
        func shouldKeep() -> Bool {
            counter += 1
            if counter >= keepEvery { counter = 0; return true }
            return false
        }
    }

    weak var delegate: MotionServiceDelegate?

    init() {
        queue.name = "ScooterCommuteETA.motion"
        queue.maxConcurrentOperationCount = 1
    }

    /// Lower the capture rate (see the battery note in the spec). Call before
    /// `startMotion()`.
    func useReducedRate() {
        deviceMotionRateHz = 25
        keepEvery = 5
    }

    // MARK: - Activity

    /// Trigger the Motion & Fitness permission prompt during onboarding by
    /// issuing a throwaway historical query.
    func primePermission() {
        guard Self.activityAvailable else { return }
        activityManager.queryActivityStarting(
            from: Date().addingTimeInterval(-60),
            to: Date(),
            to: .main
        ) { _, _ in }
    }

    func startActivityUpdates() {
        guard Self.activityAvailable else {
            log.info("Motion activity not available on this device")
            return
        }
        activityManager.startActivityUpdates(to: .main) { [weak self] activity in
            guard let self, let activity else { return }
            MainActor.assumeIsolated {
                let confident = activity.confidence != .low
                let rideLike = (activity.cycling || activity.automotive) && confident
                let stationary = activity.stationary && confident
                self.delegate?.motionService(
                    self,
                    didUpdateActivity: RideActivity(
                        isRideLike: rideLike,
                        isStationary: stationary,
                        timestamp: activity.startDate
                    )
                )
            }
        }
    }

    func stopActivityUpdates() {
        activityManager.stopActivityUpdates()
    }

    // MARK: - Accelerometer (device motion) + altimeter

    func startMotion() {
        startDeviceMotion()
        startAltimeter()
    }

    func stopMotion() {
        if motionManager.isDeviceMotionActive { motionManager.stopDeviceMotionUpdates() }
        altimeter.stopRelativeAltitudeUpdates()
    }

    private func startDeviceMotion() {
        guard motionManager.isDeviceMotionAvailable else { return }
        let sampler = Downsampler(keepEvery: keepEvery)
        motionManager.deviceMotionUpdateInterval = 1.0 / deviceMotionRateHz
        motionManager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
            guard let self, let motion else { return }
            // Downsample on the capture queue before touching the main actor.
            guard sampler.shouldKeep() else { return }

            let a = motion.userAcceleration // g, gravity removed
            let magnitude = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            let sample = RawMotionSample(
                timestamp: Date(),
                x: a.x, y: a.y, z: a.z,
                magnitude: magnitude
            )
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.delegate?.motionService(self, didSampleMotion: sample)
            }
        }
    }

    private func startAltimeter() {
        guard Self.altimeterAvailable else {
            log.info("Barometric altimeter not available on this device")
            return
        }
        altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data else { return }
            MainActor.assumeIsolated {
                let sample = RawAltitudeSample(
                    timestamp: Date(),
                    relativeAltitudeM: data.relativeAltitude.doubleValue,
                    pressureKPA: data.pressure.doubleValue
                )
                self.delegate?.motionService(self, didSampleAltitude: sample)
            }
        }
    }
}
