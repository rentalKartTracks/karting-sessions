import Foundation

/// Parsed subset of the Open-Meteo `current` block. The raw response is stored
/// verbatim on the trip; this is only for the fields we compute with.
struct WeatherSnapshot: Codable, Equatable, Sendable {
    var temperature2m: Double?
    var apparentTemperature: Double?
    var precipitation: Double?
    var rain: Double?
    var windSpeed10m: Double?      // m/s (we request wind_speed_unit=ms)
    var windDirection10m: Double?  // degrees, direction wind comes from
    var weatherCode: Int?

    enum CodingKeys: String, CodingKey {
        case temperature2m = "temperature_2m"
        case apparentTemperature = "apparent_temperature"
        case precipitation
        case rain
        case windSpeed10m = "wind_speed_10m"
        case windDirection10m = "wind_direction_10m"
        case weatherCode = "weather_code"
    }
}

private struct OpenMeteoResponse: Decodable {
    let current: WeatherSnapshot
}

extension WeatherSnapshot {
    /// Decode from a raw Open-Meteo response body (the `current` object).
    static func fromResponseBody(_ data: Data) -> WeatherSnapshot? {
        try? JSONDecoder().decode(OpenMeteoResponse.self, from: data).current
    }
}
