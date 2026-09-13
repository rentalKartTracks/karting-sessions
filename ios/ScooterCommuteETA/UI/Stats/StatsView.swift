import SwiftUI

struct StatsView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var stats: TripRepository.Stats?

    /// Below this, we deliberately show nothing quantitative — a wrong number
    /// early destroys trust in the whole thing.
    private let minTripsForStats = 15

    var body: some View {
        List {
            if let stats {
                Section {
                    LabeledContent("Trips logged", value: "\(stats.tripCount)")
                    LabeledContent("Included in model", value: "\(stats.includedCount)")
                }

                if stats.includedCount >= minTripsForStats {
                    Section("Typical commute") {
                        LabeledContent(
                            "Median duration",
                            value: Format.minutes(stats.medianDurationS)
                        )
                    }
                } else {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Not enough data yet")
                                .font(.headline)
                            Text("Log at least \(minTripsForStats) clean trips before we show timings. So far: \(stats.includedCount).")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            ProgressView(
                                value: Double(min(stats.includedCount, minTripsForStats)),
                                total: Double(minTripsForStats)
                            )
                        }
                        .padding(.vertical, 4)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Stats")
        .task { stats = try? await env.repository.stats() }
        .refreshable { stats = try? await env.repository.stats() }
    }
}

#Preview {
    NavigationStack { StatsView() }
        .environment(AppEnvironment.preview())
}
