import Foundation

enum Format {
    static func duration(_ seconds: TimeInterval?) -> String {
        guard let seconds else { return "—" }
        let total = Int(seconds.rounded())
        let m = total / 60
        let s = total % 60
        if m >= 60 {
            return "\(m / 60)h \(m % 60)m"
        }
        return m > 0 ? "\(m)m \(s)s" : "\(s)s"
    }

    static func minutes(_ seconds: TimeInterval?) -> String {
        guard let seconds else { return "—" }
        return "\(Int((seconds / 60).rounded())) min"
    }

    static func distance(_ meters: Double) -> String {
        if meters >= 1000 {
            return String(format: "%.2f km", meters / 1000)
        }
        return String(format: "%.0f m", meters)
    }

    static let date: DateFormatter = {
        let f = DateFormatter()
        f.calendar = .vilnius
        f.timeZone = Calendar.vilnius.timeZone
        f.dateFormat = "EEE d MMM, HH:mm"
        return f
    }()

    static let time: DateFormatter = {
        let f = DateFormatter()
        f.calendar = .vilnius
        f.timeZone = Calendar.vilnius.timeZone
        f.dateFormat = "HH:mm"
        return f
    }()
}
