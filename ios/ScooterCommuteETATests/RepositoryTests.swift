import XCTest
@testable import ScooterCommuteETA

final class RepositoryTests: XCTestCase {
    private func makeRepo() -> TripRepository {
        TripRepository(database: .makeInMemory())
    }

    private func sampleTrip(daysAgo: Double = 0) -> Trip {
        let ended = Date().addingTimeInterval(-daysAgo * 86_400)
        return Trip(
            id: nil,
            startedAt: ended.addingTimeInterval(-1200),
            endedAt: ended,
            startLat: 54.68, startLon: 25.27,
            endLat: 54.70, endLon: 25.25,
            distanceM: 4200, movingTimeS: 1100, stoppedTimeS: 100,
            startTrigger: .geofence, endTrigger: .geofence,
            weatherJson: nil, weatherMissing: true,
            headwindComponentMS: nil, elevationGainM: 30,
            isDark: false, dayOfWeek: 3, isHoliday: false,
            tag: nil, excluded: false, exclusionReason: nil,
            routeClusterId: nil
        )
    }

    func testCreateAndFetch() async throws {
        let repo = makeRepo()
        let created = try await repo.createTrip(sampleTrip())
        XCTAssertNotNil(created.id)
        let all = try await repo.allTrips()
        XCTAssertEqual(all.count, 1)
    }

    func testTaggingExcludesDetourAndStopped() async throws {
        let repo = makeRepo()
        let trip = try await repo.createTrip(sampleTrip())
        try await repo.setTag(.detour, forTripId: trip.id!)
        let reloaded = try await repo.trip(id: trip.id!)
        XCTAssertEqual(reloaded?.tag, .detour)
        XCTAssertTrue(reloaded?.excluded ?? false)

        // A non-excluding tag keeps the trip in the model.
        try await repo.setTag(.rushed, forTripId: trip.id!)
        let again = try await repo.trip(id: trip.id!)
        XCTAssertEqual(again?.tag, .rushed)
        XCTAssertFalse(again?.excluded ?? true)
    }

    func testStatsWithheldUntilThreshold() async throws {
        let repo = makeRepo()
        for _ in 0..<3 { _ = try await repo.createTrip(sampleTrip()) }
        let stats = try await repo.stats()
        XCTAssertEqual(stats.tripCount, 3)
        XCTAssertNotNil(stats.medianDurationS)
    }

    func testPruneKeepsSummaryDropsSamples() async throws {
        let repo = makeRepo()
        let old = try await repo.createTrip(sampleTrip(daysAgo: 200))
        try await repo.insert(fixes: [
            LocationFix(id: nil, tripId: old.id!, timestamp: old.startedAt,
                        lat: 54.68, lon: 25.27, altitude: 100,
                        horizontalAccuracy: 5, speed: 4, course: 90)
        ])
        let prunedCount = try await repo.pruneRawData(olderThan: 90)
        XCTAssertEqual(prunedCount, 1)
        let fixes = try await repo.fixes(forTripId: old.id!)
        XCTAssertTrue(fixes.isEmpty)                    // samples gone
        XCTAssertNotNil(try await repo.trip(id: old.id!)) // summary kept
    }
}
