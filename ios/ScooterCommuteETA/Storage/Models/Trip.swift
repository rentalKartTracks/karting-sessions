import Foundation
import GRDB

/// How a trip's start or end was decided. Recorded so detection can be
/// debugged from the data alone.
enum TripTrigger: String, Codable, CaseIterable, Sendable {
    case geofence
    case motion
    case manual
}

/// The outlier tag the rider optionally applies after a trip. Two of these
/// exclude the trip from the model; the rest stay in as features.
enum TripTag: String, Codable, CaseIterable, Sendable {
    case normal
    case stopped          // excluded
    case detour           // excluded
    case onCall
    case rushed
    case traffic

    var label: String {
        switch self {
        case .normal: return "Normal"
        case .stopped: return "Stopped for something"
        case .detour: return "Took a detour"
        case .onCall: return "On a call"
        case .rushed: return "Rushed"
        case .traffic: return "Traffic"
        }
    }

    /// Tagging one of these sets `excluded = true`. Never deletes the trip.
    var excludesTrip: Bool {
        self == .stopped || self == .detour
    }
}

/// One recorded commute. The summary row is kept forever; the raw fix/motion/
/// altitude samples that back it are pruned after the retention window.
struct Trip: Identifiable, Codable, Equatable, Sendable {
    var id: Int64?
    var startedAt: Date
    var endedAt: Date?

    var startLat: Double
    var startLon: Double
    var endLat: Double?
    var endLon: Double?

    var distanceM: Double
    var movingTimeS: Double
    var stoppedTimeS: Double

    var startTrigger: TripTrigger
    var endTrigger: TripTrigger?

    /// Raw Open-Meteo response captured at departure, or nil if the network
    /// was unavailable (`weatherMissing` then true).
    var weatherJson: String?
    var weatherMissing: Bool
    /// Wind projected onto the trip's straight-line bearing (m/s, +headwind).
    var headwindComponentMS: Double?

    /// Barometric elevation gain over the trip (m), from the altimeter.
    var elevationGainM: Double?

    var isDark: Bool
    /// 1 = Sunday ... 7 = Saturday, matching `Calendar.component(.weekday)`.
    var dayOfWeek: Int
    var isHoliday: Bool

    var tag: TripTag?
    var excluded: Bool
    var exclusionReason: String?

    /// Null until Phase 2 route clustering assigns one.
    var routeClusterId: Int64?

    // Convenience -------------------------------------------------------------

    var duration: TimeInterval? {
        guard let endedAt else { return nil }
        return endedAt.timeIntervalSince(startedAt)
    }
}

extension Trip: FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "trips"

    enum Columns {
        static let id = Column("id")
        static let startedAt = Column("started_at")
        static let endedAt = Column("ended_at")
        static let excluded = Column("excluded")
        static let routeClusterId = Column("route_cluster_id")
        static let dayOfWeek = Column("day_of_week")
    }

    // GRDB maps snake_case columns via CodingKeys below.
    enum CodingKeys: String, CodingKey {
        case id
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case startLat = "start_lat"
        case startLon = "start_lon"
        case endLat = "end_lat"
        case endLon = "end_lon"
        case distanceM = "distance_m"
        case movingTimeS = "moving_time_s"
        case stoppedTimeS = "stopped_time_s"
        case startTrigger = "start_trigger"
        case endTrigger = "end_trigger"
        case weatherJson = "weather_json"
        case weatherMissing = "weather_missing"
        case headwindComponentMS = "headwind_component_ms"
        case elevationGainM = "elevation_gain_m"
        case isDark = "is_dark"
        case dayOfWeek = "day_of_week"
        case isHoliday = "is_holiday"
        case tag
        case excluded
        case exclusionReason = "exclusion_reason"
        case routeClusterId = "route_cluster_id"
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
