import Foundation
import GRDB

/// Accelerometer sample, downsampled to 5 Hz from the 50 Hz device stream.
/// `userAccelMagnitude` is the gravity-removed acceleration magnitude, which is
/// what spikes on cobbles — the signal we cross-check OSM surface tags against.
struct MotionSample: Codable, Equatable, Sendable {
    var id: Int64?
    var tripId: Int64
    var timestamp: Date
    var accelX: Double
    var accelY: Double
    var accelZ: Double
    var userAccelMagnitude: Double
}

extension MotionSample: FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "motion"

    enum Columns {
        static let tripId = Column("trip_id")
    }

    enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case timestamp
        case accelX = "accel_x"
        case accelY = "accel_y"
        case accelZ = "accel_z"
        case userAccelMagnitude = "user_accel_magnitude"
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
