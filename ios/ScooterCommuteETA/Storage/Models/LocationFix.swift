import Foundation
import GRDB

/// A single GPS fix, recorded at ~1 Hz while a trip is live.
///
/// Fixes with `horizontalAccuracy > 30 m` or a negative accuracy are dropped
/// before they ever reach this table — see `TripRecorder`.
struct LocationFix: Codable, Equatable, Sendable {
    var id: Int64?
    var tripId: Int64
    var timestamp: Date
    var lat: Double
    var lon: Double
    var altitude: Double
    var horizontalAccuracy: Double
    var speed: Double
    var course: Double
}

extension LocationFix: FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "fixes"

    enum Columns {
        static let tripId = Column("trip_id")
        static let timestamp = Column("timestamp")
    }

    enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case timestamp
        case lat
        case lon
        case altitude
        case horizontalAccuracy = "horizontal_accuracy"
        case speed
        case course
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
