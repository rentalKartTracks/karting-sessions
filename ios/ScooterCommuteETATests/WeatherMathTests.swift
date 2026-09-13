import XCTest
@testable import ScooterCommuteETA

final class WeatherMathTests: XCTestCase {
    /// Wind from the north while heading north is a pure headwind (positive).
    func testPureHeadwind() {
        let h = Wind.headwindComponent(
            windSpeedMS: 5, windFromDirectionDeg: 0, travelBearingDeg: 0
        )
        XCTAssertEqual(h, 5, accuracy: 0.001)
    }

    /// Wind from the north while heading south is a pure tailwind (negative).
    func testPureTailwind() {
        let h = Wind.headwindComponent(
            windSpeedMS: 5, windFromDirectionDeg: 0, travelBearingDeg: 180
        )
        XCTAssertEqual(h, -5, accuracy: 0.001)
    }

    /// A pure crosswind contributes nothing to head/tail component.
    func testCrosswindIsZero() {
        let h = Wind.headwindComponent(
            windSpeedMS: 5, windFromDirectionDeg: 90, travelBearingDeg: 0
        )
        XCTAssertEqual(h, 0, accuracy: 0.001)
    }

    func testDecodesOpenMeteoBody() {
        let json = """
        {"current":{"temperature_2m":3.2,"apparent_temperature":-1.0,
        "precipitation":0.4,"rain":0.4,"wind_speed_10m":6.1,
        "wind_direction_10m":210,"weather_code":61}}
        """
        let snap = WeatherSnapshot.fromResponseBody(Data(json.utf8))
        XCTAssertEqual(snap?.windSpeed10m, 6.1)
        XCTAssertEqual(snap?.weatherCode, 61)
        XCTAssertEqual(snap?.apparentTemperature, -1.0)
    }
}
