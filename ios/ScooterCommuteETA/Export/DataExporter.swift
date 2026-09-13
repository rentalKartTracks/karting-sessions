import Foundation

/// "Dump everything to JSON." Ships from day one so the model can be prototyped
/// outside the app and so the schema is never a lock-in. Exports the full
/// database — trips and all raw samples — to a single file the user can share.
struct DataExporter: Sendable {
    let repository: TripRepository

    struct Export: Encodable {
        let exportedAt: Date
        let schemaVersion: Int
        let trips: [TripExport]
    }

    struct TripExport: Encodable {
        let trip: Trip
        let fixes: [LocationFix]
        let motion: [MotionSample]
        let altitude: [AltitudeSample]
    }

    /// Write the export to a temporary file and return its URL for sharing.
    func exportToFile() async throws -> URL {
        let trips = try await repository.allTrips()
        var tripExports: [TripExport] = []
        tripExports.reserveCapacity(trips.count)
        for trip in trips {
            guard let id = trip.id else { continue }
            async let fixes = repository.fixes(forTripId: id)
            async let motion = repository.motion(forTripId: id)
            async let altitude = repository.altitude(forTripId: id)
            tripExports.append(TripExport(
                trip: trip,
                fixes: try await fixes,
                motion: try await motion,
                altitude: try await altitude
            ))
        }

        let export = Export(exportedAt: Date(), schemaVersion: 1, trips: tripExports)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(export)

        let stamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("scooter-export-\(stamp).json")
        try data.write(to: url, options: .atomic)
        return url
    }
}
