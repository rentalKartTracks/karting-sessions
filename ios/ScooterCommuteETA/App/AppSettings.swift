import CoreLocation
import Foundation
import Observation

/// Small, non-time-series configuration. Trips and samples live in SQLite;
/// this is just the handful of setup values, kept in `UserDefaults`.
@Observable
final class AppSettings {
    static let radiusMeters: CLLocationDistance = 150

    private let defaults: UserDefaults
    private enum Key {
        static let homeLat = "home_lat"
        static let homeLon = "home_lon"
        static let workLat = "work_lat"
        static let workLon = "work_lon"
        static let onboarded = "onboarded"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.home = Self.readCoordinate(defaults, Key.homeLat, Key.homeLon)
        self.work = Self.readCoordinate(defaults, Key.workLat, Key.workLon)
        self.hasCompletedOnboarding = defaults.bool(forKey: Key.onboarded)
    }

    var home: CLLocationCoordinate2D? {
        didSet { Self.writeCoordinate(defaults, home, Key.homeLat, Key.homeLon) }
    }

    var work: CLLocationCoordinate2D? {
        didSet { Self.writeCoordinate(defaults, work, Key.workLat, Key.workLon) }
    }

    var hasCompletedOnboarding: Bool {
        didSet { defaults.set(hasCompletedOnboarding, forKey: Key.onboarded) }
    }

    /// Both endpoints are needed before automatic detection can run.
    var isConfigured: Bool { home != nil && work != nil }

    // MARK: - Persistence helpers

    private static func readCoordinate(
        _ d: UserDefaults, _ latKey: String, _ lonKey: String
    ) -> CLLocationCoordinate2D? {
        guard d.object(forKey: latKey) != nil, d.object(forKey: lonKey) != nil else {
            return nil
        }
        return CLLocationCoordinate2D(
            latitude: d.double(forKey: latKey),
            longitude: d.double(forKey: lonKey)
        )
    }

    private static func writeCoordinate(
        _ d: UserDefaults, _ c: CLLocationCoordinate2D?, _ latKey: String, _ lonKey: String
    ) {
        if let c {
            d.set(c.latitude, forKey: latKey)
            d.set(c.longitude, forKey: lonKey)
        } else {
            d.removeObject(forKey: latKey)
            d.removeObject(forKey: lonKey)
        }
    }
}
