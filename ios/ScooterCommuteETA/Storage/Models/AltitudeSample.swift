import Foundation
import GRDB

/// Barometric altitude sample at ~1 Hz from `CMAltimeter`. Relative altitude is
/// far more precise than GPS altitude for elevation gain, so this is the source
/// used for `Trip.elevationGainM`.
struct AltitudeSample: Codable, Equatable, Sendable {
    var id: Int64?
    var tripId: Int64
    var timestamp: Date
    var relativeAltitudeM: Double
    var pressureKPA: Double
}

extension AltitudeSample: FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "altitude"

    enum Columns {
        static let tripId = Column("trip_id")
    }

    enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case timestamp
        case relativeAltitudeM = "relative_altitude_m"
        case pressureKPA = "pressure_kpa"
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
