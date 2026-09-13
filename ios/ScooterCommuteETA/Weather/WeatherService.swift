import CoreLocation
import Foundation
import OSLog

/// Fetches a weather snapshot from Open-Meteo at trip start.
///
/// Privacy: the coordinate is coarsened to two decimals (~1 km) before it
/// leaves the device. No API key, no account, no other network calls.
struct WeatherService: Sendable {
    struct Result: Sendable {
        /// Raw response body as a UTF-8 string, stored on the trip verbatim.
        let rawJSON: String
        let snapshot: WeatherSnapshot
    }

    // Note: WeatherService itself is a Sendable value type (URLSession is
    // Sendable), so it can be captured into the coordinator's weather Task.

    private static let log = Logger(subsystem: "ScooterCommuteETA", category: "weather")
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Returns nil if the network is unavailable or the response is unusable.
    /// The caller stores null and marks the trip — weather never blocks
    /// recording.
    func snapshot(at coordinate: CLLocationCoordinate2D) async -> Result? {
        let coarse = Geo.coarsened(coordinate)
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.2f", coarse.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.2f", coarse.longitude)),
            URLQueryItem(name: "wind_speed_unit", value: "ms"),
            URLQueryItem(name: "current", value: [
                "temperature_2m",
                "apparent_temperature",
                "precipitation",
                "rain",
                "wind_speed_10m",
                "wind_direction_10m",
                "weather_code",
            ].joined(separator: ",")),
        ]
        guard let url = components.url else { return nil }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                Self.log.warning("Weather fetch returned non-200")
                return nil
            }
            guard let snapshot = WeatherSnapshot.fromResponseBody(data),
                  let raw = String(data: data, encoding: .utf8) else {
                return nil
            }
            return Result(rawJSON: raw, snapshot: snapshot)
        } catch {
            Self.log.warning("Weather fetch failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}
