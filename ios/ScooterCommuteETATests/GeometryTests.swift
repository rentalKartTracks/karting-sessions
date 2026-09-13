import CoreLocation
import XCTest
@testable import ScooterCommuteETA

final class GeometryTests: XCTestCase {
    func testHaversineKnownDistance() {
        // Vilnius cathedral to the TV tower, ~4.9 km.
        let a = CLLocationCoordinate2D(latitude: 54.6858, longitude: 25.2877)
        let b = CLLocationCoordinate2D(latitude: 54.6892, longitude: 25.2110)
        let d = Geo.distance(from: a, to: b)
        XCTAssertEqual(d, 4_930, accuracy: 200)
    }

    func testBearingDueEast() {
        let a = CLLocationCoordinate2D(latitude: 0, longitude: 0)
        let b = CLLocationCoordinate2D(latitude: 0, longitude: 1)
        XCTAssertEqual(Geo.bearing(from: a, to: b), 90, accuracy: 0.5)
    }

    func testBearingDueNorth() {
        let a = CLLocationCoordinate2D(latitude: 0, longitude: 0)
        let b = CLLocationCoordinate2D(latitude: 1, longitude: 0)
        XCTAssertEqual(Geo.bearing(from: a, to: b), 0, accuracy: 0.5)
    }

    func testCoarseningRoundsToTwoDecimals() {
        let c = Geo.coarsened(CLLocationCoordinate2D(latitude: 54.68723, longitude: 25.27971))
        XCTAssertEqual(c.latitude, 54.69, accuracy: 0.0001)
        XCTAssertEqual(c.longitude, 25.28, accuracy: 0.0001)
    }
}
