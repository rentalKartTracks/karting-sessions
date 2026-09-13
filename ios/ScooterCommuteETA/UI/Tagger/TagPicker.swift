import SwiftUI

/// The six-button outlier picker, shared by the detail screen and the
/// notification-driven sheet.
struct TagPicker: View {
    let current: TripTag?
    let onSelect: (TripTag) -> Void

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(TripTag.allCases, id: \.self) { tag in
                Button {
                    onSelect(tag)
                } label: {
                    HStack {
                        Text(tag.label)
                            .font(.subheadline)
                            .multilineTextAlignment(.leading)
                        Spacer()
                        if current == tag {
                            Image(systemName: "checkmark")
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(current == tag ? Color.accentColor.opacity(0.18) : Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
    }
}
