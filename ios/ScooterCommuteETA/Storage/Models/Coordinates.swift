import CoreLocation

extension LocationFix {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

extension Trip {
    var startCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: startLat, longitude: startLon)
    }

    var endCoordinate: CLLocationCoordinate2D? {
        guard let endLat, let endLon else { return nil }
        return CLLocationCoordinate2D(latitude: endLat, longitude: endLon)
    }
}
