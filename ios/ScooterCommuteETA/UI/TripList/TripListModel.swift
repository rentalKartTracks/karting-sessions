import Foundation
import Observation

/// Backs the trip list with a live-updating query. GRDB pushes a new array
/// whenever any trip changes, so the list stays in sync with recording.
@MainActor
@Observable
final class TripListModel {
    private(set) var trips: [Trip] = []
    private(set) var isLoaded = false

    private let repository: TripRepository

    init(repository: TripRepository) {
        self.repository = repository
    }

    func observe() async {
        do {
            for try await value in repository.observeTrips() {
                trips = value
                isLoaded = true
            }
        } catch {
            // Observation ends on error; the list keeps its last value.
            isLoaded = true
        }
    }
}
