import Foundation
import GRDB
import OSLog

/// Owns the SQLite connection and the schema migrations. One instance for the
/// whole app, created at launch and injected everywhere.
///
/// A `DatabasePool` (WAL mode) is used so the UI can read while the recorder
/// writes a live trip's samples.
final class AppDatabase: Sendable {
    let writer: any DatabaseWriter
    private static let log = Logger(subsystem: "ScooterCommuteETA", category: "db")

    init(_ writer: any DatabaseWriter) throws {
        self.writer = writer
        try migrator.migrate(writer)
    }

    /// The on-disk database in Application Support.
    static func makeShared() -> AppDatabase {
        do {
            let fm = FileManager.default
            let folder = try fm.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            ).appendingPathComponent("database", isDirectory: true)
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
            let dbURL = folder.appendingPathComponent("scooter.sqlite")

            var config = Configuration()
            config.foreignKeysEnabled = true
            // Busy timeout so a UI read never fails against a recording write.
            config.busyMode = .timeout(5)

            let pool = try DatabasePool(path: dbURL.path, configuration: config)
            let db = try AppDatabase(pool)
            log.info("Database opened at \(dbURL.path, privacy: .public)")
            return db
        } catch {
            // A broken database is unrecoverable and would silently lose data.
            // Crash loudly in that case rather than run without storage.
            fatalError("Unresolved database error: \(error)")
        }
    }

    /// In-memory database for tests and SwiftUI previews.
    static func makeInMemory() -> AppDatabase {
        // swiftlint:disable:next force_try
        try! AppDatabase(DatabaseQueue())
    }

    // MARK: - Migrations

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        #if DEBUG
        // During development, wipe and rebuild if a migration definition
        // changes. Removed before shipping so real data is never erased.
        migrator.eraseDatabaseOnSchemaChange = true
        #endif

        migrator.registerMigration("v1_initial") { db in
            try db.create(table: "trips") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("started_at", .datetime).notNull().indexed()
                t.column("ended_at", .datetime)
                t.column("start_lat", .double).notNull()
                t.column("start_lon", .double).notNull()
                t.column("end_lat", .double)
                t.column("end_lon", .double)
                t.column("distance_m", .double).notNull().defaults(to: 0)
                t.column("moving_time_s", .double).notNull().defaults(to: 0)
                t.column("stopped_time_s", .double).notNull().defaults(to: 0)
                t.column("start_trigger", .text).notNull()
                t.column("end_trigger", .text)
                t.column("weather_json", .text)
                t.column("weather_missing", .boolean).notNull().defaults(to: false)
                t.column("headwind_component_ms", .double)
                t.column("elevation_gain_m", .double)
                t.column("is_dark", .boolean).notNull().defaults(to: false)
                t.column("day_of_week", .integer).notNull()
                t.column("is_holiday", .boolean).notNull().defaults(to: false)
                t.column("tag", .text)
                t.column("excluded", .boolean).notNull().defaults(to: false)
                t.column("exclusion_reason", .text)
                t.column("route_cluster_id", .integer)
            }

            try db.create(table: "fixes") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("trip_id", .integer)
                    .notNull()
                    .references("trips", onDelete: .cascade)
                t.column("timestamp", .datetime).notNull()
                t.column("lat", .double).notNull()
                t.column("lon", .double).notNull()
                t.column("altitude", .double).notNull()
                t.column("horizontal_accuracy", .double).notNull()
                t.column("speed", .double).notNull()
                t.column("course", .double).notNull()
            }
            try db.create(
                index: "idx_fixes_trip_time",
                on: "fixes",
                columns: ["trip_id", "timestamp"]
            )

            try db.create(table: "motion") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("trip_id", .integer)
                    .notNull()
                    .references("trips", onDelete: .cascade)
                t.column("timestamp", .datetime).notNull()
                t.column("accel_x", .double).notNull()
                t.column("accel_y", .double).notNull()
                t.column("accel_z", .double).notNull()
                t.column("user_accel_magnitude", .double).notNull()
            }
            try db.create(
                index: "idx_motion_trip_time",
                on: "motion",
                columns: ["trip_id", "timestamp"]
            )

            try db.create(table: "altitude") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("trip_id", .integer)
                    .notNull()
                    .references("trips", onDelete: .cascade)
                t.column("timestamp", .datetime).notNull()
                t.column("relative_altitude_m", .double).notNull()
                t.column("pressure_kpa", .double).notNull()
            }
            try db.create(
                index: "idx_altitude_trip_time",
                on: "altitude",
                columns: ["trip_id", "timestamp"]
            )
        }

        return migrator
    }
}
