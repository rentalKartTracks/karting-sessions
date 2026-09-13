import CoreLocation
import Foundation

/// Great-circle geometry helpers. Everything here is pure and side-effect free
/// so it can be unit-tested without any of the Core* frameworks running.
enum Geo {
    static let earthRadiusMeters = 6_371_000.0

    /// Haversine distance in meters between two coordinates.
    static func distance(
        from a: CLLocationCoordinate2D,
        to b: CLLocationCoordinate2D
    ) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180

        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return earthRadiusMeters * 2 * atan2(sqrt(h), sqrt(1 - h))
    }

    /// Initial bearing (forward azimuth) from `a` to `b`, in degrees [0, 360).
    /// 0° is true north, 90° is east.
    static func bearing(
        from a: CLLocationCoordinate2D,
        to b: CLLocationCoordinate2D
    ) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180

        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        let deg = atan2(y, x) * 180 / .pi
        return (deg + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Coarsen a coordinate to two decimal places (~1.1 km). Used before any
    /// network call so that only a rough location ever leaves the device.
    static func coarsened(_ c: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(
            latitude: (c.latitude * 100).rounded() / 100,
            longitude: (c.longitude * 100).rounded() / 100
        )
    }
}
