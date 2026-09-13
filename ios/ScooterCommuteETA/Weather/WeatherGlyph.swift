import Foundation

extension Trip {
    /// Decodes the stored raw response back into the parsed snapshot, if any.
    var weatherSnapshot: WeatherSnapshot? {
        guard let json = weatherJson, let data = json.data(using: .utf8) else { return nil }
        return WeatherSnapshot.fromResponseBody(data)
    }
}

enum WeatherGlyph {
    /// SF Symbol name for a WMO weather code (Open-Meteo's `weather_code`).
    static func symbol(for code: Int?) -> String {
        guard let code else { return "questionmark" }
        switch code {
        case 0: return "sun.max"
        case 1, 2: return "cloud.sun"
        case 3: return "cloud"
        case 45, 48: return "cloud.fog"
        case 51, 53, 55, 56, 57: return "cloud.drizzle"
        case 61, 63, 65, 66, 67: return "cloud.rain"
        case 71, 73, 75, 77: return "cloud.snow"
        case 80, 81, 82: return "cloud.heavyrain"
        case 85, 86: return "cloud.snow"
        case 95, 96, 99: return "cloud.bolt.rain"
        default: return "cloud"
        }
    }
}
