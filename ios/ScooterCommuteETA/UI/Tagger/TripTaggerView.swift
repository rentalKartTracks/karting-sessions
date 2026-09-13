import SwiftUI

/// One-screen tagger presented when the post-trip notification is tapped.
struct TripTaggerView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    let tripId: Int64

    @State private var trip: Trip?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let trip {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(Format.minutes(trip.duration)) ride")
                        .font(.title2.bold())
                    Text("\(Format.distance(trip.distanceM)) · \(Format.date.string(from: trip.startedAt))")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Text("Anything unusual?").font(.headline)
                TagPicker(current: trip.tag) { tag in
                    Task {
                        try? await env.repository.setTag(tag, forTripId: tripId)
                        dismiss()
                    }
                }
                Spacer()
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Skip") { dismiss() }
            }
        }
        .task { trip = try? await env.repository.trip(id: tripId) }
    }
}
