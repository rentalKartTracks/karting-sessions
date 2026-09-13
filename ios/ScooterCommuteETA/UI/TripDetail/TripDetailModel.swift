import CoreLocation
import Foundation
import Observation

@MainActor
@Observable
final class TripDetailModel {
    private(set) var trip: Trip?
    private(set) var fixes: [LocationFix] = []
    private(set) var altitude: [AltitudeSample] = []
    private(set) var loaded = false

    private let repository: TripRepository
    private let tripId: Int64

    init(repository: TripRepository, tripId: Int64) {
        self.repository = repository
        self.tripId = tripId
    }

    func load() async {
        async let t = repository.trip(id: tripId)
        async let f = repository.fixes(forTripId: tripId)
        async let a = repository.altitude(forTripId: tripId)
        trip = (try? await t) ?? nil
        fixes = (try? await f) ?? []
        altitude = (try? await a) ?? []
        loaded = true
    }

    var coordinates: [CLLocationCoordinate2D] {
        fixes.map(\.coordinate)
    }

    /// Speed samples as (elapsed seconds, km/h), using GPS speed where valid.
    var speedSeries: [(t: Double, v: Double)] {
        guard let start = fixes.first?.timestamp else { return [] }
        return fixes.map { fix in
            let kmh = max(fix.speed, 0) * 3.6
            return (fix.timestamp.timeIntervalSince(start), kmh)
        }
    }

    /// Barometric elevation profile as (elapsed seconds, relative meters).
    var elevationSeries: [(t: Double, v: Double)] {
        guard let start = altitude.first?.timestamp else { return [] }
        return altitude.map { ($0.timestamp.timeIntervalSince(start), $0.relativeAltitudeM) }
    }
}
