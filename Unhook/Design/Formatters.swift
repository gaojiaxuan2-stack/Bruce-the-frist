import Foundation

extension Double {
    /// This value as a whole number in 0...1e15. Clamps before converting because `Int(Double)`
    /// traps on huge or non-finite values.
    var clampedWholeNumber: Int {
        guard !isNaN else { return 0 }
        return Int(min(max(self, 0), 1e15))
    }
}

enum DurationFormatter {
    struct Parts: Equatable {
        let days: Int
        let hours: Int
        let minutes: Int
        let seconds: Int
    }

    static func parts(_ interval: TimeInterval) -> Parts {
        let total = interval.clampedWholeNumber
        return Parts(
            days: total / 86_400,
            hours: (total % 86_400) / 3_600,
            minutes: (total % 3_600) / 60,
            seconds: total % 60
        )
    }

    /// Two most significant units: "3d 4h", "4h 12m", "12m 5s", "5s".
    static func compact(_ interval: TimeInterval) -> String {
        let p = parts(interval)
        if p.days > 0 { return "\(p.days)d \(p.hours)h" }
        if p.hours > 0 { return "\(p.hours)h \(p.minutes)m" }
        if p.minutes > 0 { return "\(p.minutes)m \(p.seconds)s" }
        return "\(p.seconds)s"
    }

    /// Three units for live streak cards: "12d 4h 32m", "4h 12m 9s", "12m 9s".
    static func detailed(_ interval: TimeInterval) -> String {
        let p = parts(interval)
        if p.days > 0 { return "\(p.days)d \(p.hours)h \(p.minutes)m" }
        if p.hours > 0 { return "\(p.hours)h \(p.minutes)m \(p.seconds)s" }
        return "\(p.minutes)m \(p.seconds)s"
    }

    /// Time reclaimed, given in minutes: "45m", "2h 5m", "1d 1h".
    static func minutes(_ minutes: Double) -> String {
        let total = minutes.clampedWholeNumber
        let days = total / 1_440
        let hours = (total % 1_440) / 60
        let mins = total % 60
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(mins)m" }
        return "\(mins)m"
    }
}

enum MoneyFormatter {
    /// Full precision, so the home banner visibly ticks up every second.
    static func precise(_ amount: Double, code: String) -> String {
        amount.formatted(.currency(code: code))
    }

    /// Whole units for tiles and share cards.
    static func rounded(_ amount: Double, code: String) -> String {
        amount.formatted(.currency(code: code).precision(.fractionLength(0)))
    }
}
