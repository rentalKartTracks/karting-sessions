import CoreLocation
import Foundation

/// Sunrise / sunset computation using the NOAA solar-position equations.
///
/// Accurate to within about a minute for our latitudes, which is far more than
/// we need for an `is_dark` flag. No network, no dependencies.
enum SolarCalculator {
    /// Default reference location for the commute: Vilnius, Lithuania.
    static let vilnius = CLLocationCoordinate2D(latitude: 54.6872, longitude: 25.2797)

    struct SunTimes {
        /// May be nil above/below the polar circles where the sun does not
        /// rise or set on the given day. Not reachable from Vilnius, but the
        /// type is honest about it.
        let sunrise: Date?
        let sunset: Date?
    }

    /// Whether `date` at `coordinate` falls between sunset and the next
    /// sunrise (i.e. it is dark outside). Uses the official sunrise/sunset
    /// zenith of 90.833° (includes atmospheric refraction and the solar disk).
    static func isDark(at date: Date, coordinate: CLLocationCoordinate2D) -> Bool {
        let times = sunTimes(for: date, coordinate: coordinate)
        guard let sunrise = times.sunrise, let sunset = times.sunset else {
            // Polar day/night fallback: decide by solar elevation sign.
            return solarElevation(at: date, coordinate: coordinate) < 0
        }
        return date < sunrise || date > sunset
    }

    static func sunTimes(for date: Date, coordinate: CLLocationCoordinate2D) -> SunTimes {
        SunTimes(
            sunrise: event(.sunrise, date: date, coordinate: coordinate),
            sunset: event(.sunset, date: date, coordinate: coordinate)
        )
    }

    // MARK: - Implementation

    private enum Event { case sunrise, sunset }
    private static let officialZenith = 90.833

    private static func event(
        _ event: Event,
        date: Date,
        coordinate: CLLocationCoordinate2D
    ) -> Date? {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let comps = utc.dateComponents([.year, .month, .day], from: date)
        guard let year = comps.year, let month = comps.month, let day = comps.day else {
            return nil
        }

        // Day of year.
        let n = dayOfYear(year: year, month: month, day: day)
        let lngHour = coordinate.longitude / 15.0

        // Approximate time.
        let t = event == .sunrise
            ? Double(n) + ((6.0 - lngHour) / 24.0)
            : Double(n) + ((18.0 - lngHour) / 24.0)

        // Mean anomaly.
        let M = (0.9856 * t) - 3.289

        // True longitude.
        var L = M + (1.916 * sinDeg(M)) + (0.020 * sinDeg(2 * M)) + 282.634
        L = normalize(L, 360)

        // Right ascension, put in same quadrant as L.
        var RA = atanDeg(0.91764 * tanDeg(L))
        RA = normalize(RA, 360)
        let lQuadrant = floor(L / 90.0) * 90.0
        let raQuadrant = floor(RA / 90.0) * 90.0
        RA = (RA + (lQuadrant - raQuadrant)) / 15.0

        // Declination.
        let sinDec = 0.39782 * sinDeg(L)
        let cosDec = cosDeg(asinDeg(sinDec))

        // Local hour angle.
        let cosH = (cosDeg(officialZenith) - (sinDec * sinDeg(coordinate.latitude)))
            / (cosDec * cosDeg(coordinate.latitude))
        if cosH > 1 { return nil }  // sun never rises
        if cosH < -1 { return nil } // sun never sets

        var H = event == .sunrise ? 360.0 - acosDeg(cosH) : acosDeg(cosH)
        H /= 15.0

        // Local mean time of the event, then to UTC.
        let T = H + RA - (0.06571 * t) - 6.622
        let ut = normalize(T - lngHour, 24)

        var eventComps = DateComponents()
        eventComps.year = year
        eventComps.month = month
        eventComps.day = day
        eventComps.hour = Int(ut)
        eventComps.minute = Int((ut - Double(Int(ut))) * 60)
        eventComps.second = 0
        return utc.date(from: eventComps)
    }

    /// Solar elevation angle in degrees; only used for the polar fallback.
    private static func solarElevation(
        at date: Date,
        coordinate: CLLocationCoordinate2D
    ) -> Double {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let c = utc.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let n = dayOfYear(year: c.year!, month: c.month!, day: c.day!)
        let frac = Double(c.hour ?? 0) + Double(c.minute ?? 0) / 60.0
        let decl = 23.44 * sinDeg(360.0 / 365.0 * (Double(n) - 81))
        let hourAngle = 15.0 * (frac - 12.0) + coordinate.longitude
        return asinDeg(
            sinDeg(coordinate.latitude) * sinDeg(decl)
            + cosDeg(coordinate.latitude) * cosDeg(decl) * cosDeg(hourAngle)
        )
    }

    private static func dayOfYear(year: Int, month: Int, day: Int) -> Int {
        let n1 = floor(275.0 * Double(month) / 9.0)
        let n2 = floor(Double(month + 9) / 12.0)
        let n3 = 1.0 + floor(Double(year - 4 * (year / 4) + 2) / 3.0)
        return Int(n1 - (n2 * n3) + Double(day) - 30)
    }

    // Degree-based trig wrappers keep the equations readable.
    private static func sinDeg(_ d: Double) -> Double { sin(d * .pi / 180) }
    private static func cosDeg(_ d: Double) -> Double { cos(d * .pi / 180) }
    private static func tanDeg(_ d: Double) -> Double { tan(d * .pi / 180) }
    private static func asinDeg(_ x: Double) -> Double { asin(x) * 180 / .pi }
    private static func acosDeg(_ x: Double) -> Double { acos(x) * 180 / .pi }
    private static func atanDeg(_ x: Double) -> Double { atan(x) * 180 / .pi }
    private static func normalize(_ v: Double, _ range: Double) -> Double {
        let r = v.truncatingRemainder(dividingBy: range)
        return r < 0 ? r + range : r
    }
}
