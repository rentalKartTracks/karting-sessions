import Foundation

enum Wind {
    /// Component of wind that opposes forward motion, in m/s.
    ///
    /// Positive means a headwind (slows you down), negative means a tailwind.
    /// This is the number that actually correlates with ride speed — raw wind
    /// speed does not, because a strong crosswind barely matters.
    ///
    /// Meteorological convention: `windFromDirectionDeg` is the compass
    /// direction the wind blows *from* (0° = from the north). `travelBearingDeg`
    /// is the direction of travel (0° = heading north). A wind coming from the
    /// north while heading north is a pure headwind, hence `cos(0) = +1`.
    static func headwindComponent(
        windSpeedMS: Double,
        windFromDirectionDeg: Double,
        travelBearingDeg: Double
    ) -> Double {
        let delta = (windFromDirectionDeg - travelBearingDeg) * .pi / 180
        return windSpeedMS * cos(delta)
    }
}
