import CoreLocation
import Foundation
import OSLog

/// Thin wrapper over `CLLocationManager`. It owns authorization, the two
/// endpoint geofences, and full-rate location updates. It holds no trip logic —
/// it just forwards events to its `delegate` (the `RideCoordinator`).
///
/// CoreLocation delivers callbacks on the queue the manager was created on. We
/// create it on the main actor, so every delegate method hops back with
/// `MainActor.assumeIsolated`.
@MainActor
protocol LocationServiceDelegate: AnyObject {
    func locationService(_ s: LocationService, didUpdate locations: [CLLocation])
    func locationService(_ s: LocationService, didExitRegion id: String)
    func locationService(_ s: LocationService, didEnterRegion id: String)
    func locationServiceDidChangeAuthorization(_ s: LocationService)
}

@MainActor
final class LocationService: NSObject {
    static let homeRegionId = "home"
    static let workRegionId = "work"

    private let manager = CLLocationManager()
    private let log = Logger(subsystem: "ScooterCommuteETA", category: "location")
    weak var delegate: LocationServiceDelegate?

    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
        // Be visible about tracking; never hide the background indicator.
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
    }

    // MARK: - Authorization

    func requestWhenInUse() { manager.requestWhenInUseAuthorization() }
    func requestAlways() { manager.requestAlwaysAuthorization() }

    // MARK: - Geofences

    /// Register 150 m circular regions around the two endpoints. Region exit
    /// wakes the app to start a trip; region entry ends it.
    func monitorEndpoints(home: CLLocationCoordinate2D, work: CLLocationCoordinate2D) {
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        register(home, id: Self.homeRegionId)
        register(work, id: Self.workRegionId)
    }

    private func register(_ center: CLLocationCoordinate2D, id: String) {
        let region = CLCircularRegion(
            center: center,
            radius: AppSettings.radiusMeters,
            identifier: id
        )
        region.notifyOnEntry = true
        region.notifyOnExit = true
        manager.startMonitoring(for: region)
    }

    // MARK: - Full-rate updates

    func startHighRateUpdates() {
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.startUpdatingLocation()
    }

    func stopHighRateUpdates() {
        manager.stopUpdatingLocation()
    }

    /// One-shot request for the current location, used during onboarding to
    /// pin home/work.
    func requestOneShot() {
        manager.requestLocation()
    }
}

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManager(
        _ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]
    ) {
        MainActor.assumeIsolated {
            delegate?.locationService(self, didUpdate: locations)
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager, didExitRegion region: CLRegion
    ) {
        MainActor.assumeIsolated {
            log.info("Exited region \(region.identifier, privacy: .public)")
            delegate?.locationService(self, didExitRegion: region.identifier)
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager, didEnterRegion region: CLRegion
    ) {
        MainActor.assumeIsolated {
            log.info("Entered region \(region.identifier, privacy: .public)")
            delegate?.locationService(self, didEnterRegion: region.identifier)
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated {
            delegate?.locationServiceDidChangeAuthorization(self)
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager, didFailWithError error: Error
    ) {
        MainActor.assumeIsolated {
            log.warning("Location error: \(error.localizedDescription, privacy: .public)")
        }
    }
}
