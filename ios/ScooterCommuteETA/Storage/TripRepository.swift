import Foundation
import GRDB

/// All database access goes through here. Reads use GRDB's async APIs so they
/// never block the main actor; the recorder's high-volume writes are batched.
struct TripRepository: Sendable {
    let database: AppDatabase
    private var writer: any DatabaseWriter { database.writer }

    // MARK: - Trips

    /// Insert a freshly started trip and return it with its assigned id.
    func createTrip(_ trip: Trip) async throws -> Trip {
        try await writer.write { db in
            var t = trip
            try t.insert(db)
            return t
        }
    }

    func updateTrip(_ trip: Trip) async throws {
        try await writer.write { db in
            try trip.update(db)
        }
    }

    func deleteTrip(id: Int64) async throws {
        // Samples cascade via the foreign keys.
        _ = try await writer.write { db in
            try Trip.deleteOne(db, key: id)
        }
    }

    func trip(id: Int64) async throws -> Trip? {
        try await writer.read { db in
            try Trip.fetchOne(db, key: id)
        }
    }

    func allTrips() async throws -> [Trip] {
        try await writer.read { db in
            try Trip
                .order(Trip.Columns.startedAt.desc)
                .fetchAll(db)
        }
    }

    /// Live-updating list of trips, newest first, for the trip-list screen.
    func observeTrips() -> AsyncValueObservation<[Trip]> {
        ValueObservation
            .tracking { db in
                try Trip.order(Trip.Columns.startedAt.desc).fetchAll(db)
            }
            .values(in: writer)
    }

    /// Apply an outlier tag. Never deletes; only flips `excluded`.
    func setTag(_ tag: TripTag, forTripId id: Int64) async throws {
        try await writer.write { db in
            guard var trip = try Trip.fetchOne(db, key: id) else { return }
            trip.tag = tag
            trip.excluded = tag.excludesTrip
            trip.exclusionReason = tag.excludesTrip ? tag.label : nil
            try trip.update(db)
        }
    }

    // MARK: - Samples (batched, high volume)

    func insert(fixes: [LocationFix]) async throws {
        guard !fixes.isEmpty else { return }
        try await writer.write { db in
            for var f in fixes { try f.insert(db) }
        }
    }

    func insert(motion samples: [MotionSample]) async throws {
        guard !samples.isEmpty else { return }
        try await writer.write { db in
            for var m in samples { try m.insert(db) }
        }
    }

    func insert(altitude samples: [AltitudeSample]) async throws {
        guard !samples.isEmpty else { return }
        try await writer.write { db in
            for var a in samples { try a.insert(db) }
        }
    }

    func fixes(forTripId id: Int64) async throws -> [LocationFix] {
        try await writer.read { db in
            try LocationFix
                .filter(LocationFix.Columns.tripId == id)
                .order(LocationFix.Columns.timestamp)
                .fetchAll(db)
        }
    }

    func motion(forTripId id: Int64) async throws -> [MotionSample] {
        try await writer.read { db in
            try MotionSample
                .filter(MotionSample.Columns.tripId == id)
                .order(Column("timestamp"))
                .fetchAll(db)
        }
    }

    func altitude(forTripId id: Int64) async throws -> [AltitudeSample] {
        try await writer.read { db in
            try AltitudeSample
                .filter(AltitudeSample.Columns.tripId == id)
                .order(Column("timestamp"))
                .fetchAll(db)
        }
    }

    // MARK: - Stats

    struct Stats: Sendable {
        var tripCount: Int
        var includedCount: Int
        var medianDurationS: Double?
    }

    func stats() async throws -> Stats {
        try await writer.read { db in
            let count = try Trip.fetchCount(db)
            let includedDurations = try Double.fetchAll(db, sql: """
                SELECT (julianday(ended_at) - julianday(started_at)) * 86400.0
                FROM trips
                WHERE ended_at IS NOT NULL AND excluded = 0
                ORDER BY 1
                """)
            return Stats(
                tripCount: count,
                includedCount: includedDurations.count,
                medianDurationS: Self.median(includedDurations)
            )
        }
    }

    private static func median(_ sorted: [Double]) -> Double? {
        guard !sorted.isEmpty else { return nil }
        let mid = sorted.count / 2
        if sorted.count % 2 == 0 {
            return (sorted[mid - 1] + sorted[mid]) / 2
        }
        return sorted[mid]
    }

    // MARK: - Retention

    /// Delete raw fix / motion / altitude samples for trips that ended more
    /// than `days` ago. Summary rows are kept forever.
    @discardableResult
    func pruneRawData(olderThan days: Int = 90, now: Date = Date()) async throws -> Int {
        let cutoff = now.addingTimeInterval(-Double(days) * 86_400)
        return try await writer.write { db in
            let staleIds = try Int64.fetchAll(db, sql: """
                SELECT id FROM trips WHERE ended_at IS NOT NULL AND ended_at < ?
                """, arguments: [cutoff])
            guard !staleIds.isEmpty else { return 0 }
            for table in ["fixes", "motion", "altitude"] {
                try db.execute(sql: """
                    DELETE FROM \(table) WHERE trip_id IN (\(staleIds.map(String.init).joined(separator: ",")))
                    """)
            }
            return staleIds.count
        }
    }
}
