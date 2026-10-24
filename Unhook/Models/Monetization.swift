import Foundation

/// What the free tier includes. Crisis help (SOS), streaks, milestones and the recovery timeline are
/// always free; Pro unlocks tracking several habits at once and the extras below.
enum ProLimits {
    static let freeHabits = 1
    static let freeGoals = 1

    static func canAddHabit(currentCount: Int, isPro: Bool) -> Bool {
        isPro || currentCount < freeHabits
    }

    static func canAddGoal(activeCount: Int, isPro: Bool) -> Bool {
        isPro || activeCount < freeGoals
    }
}

/// Why the paywall was opened. Used to tailor its headline.
enum PaywallReason: String, Identifiable {
    case onboarding, moreHabits, moreGoals, insights, appIcons, settings

    var id: String { rawValue }
}

/// Alternate home-screen icons (a Pro perk). Asset names must match the app icon sets in Assets.xcassets
/// and the ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES build setting.
enum AppIconOption: String, CaseIterable, Identifiable {
    case standard, midnight, sunrise, forest

    var id: String { rawValue }

    /// Name passed to `UIApplication.setAlternateIconName`; nil restores the primary icon.
    var alternateIconName: String? {
        switch self {
        case .standard: nil
        case .midnight: "AppIcon-Midnight"
        case .sunrise: "AppIcon-Sunrise"
        case .forest: "AppIcon-Forest"
        }
    }

    /// Image set used to preview the icon inside the app (app icon sets can't be loaded as images).
    var previewImageName: String {
        switch self {
        case .standard: "IconPreview-Standard"
        case .midnight: "IconPreview-Midnight"
        case .sunrise: "IconPreview-Sunrise"
        case .forest: "IconPreview-Forest"
        }
    }

    var title: String {
        switch self {
        case .standard: String(localized: "Classic")
        case .midnight: String(localized: "Midnight")
        case .sunrise: String(localized: "Sunrise")
        case .forest: String(localized: "Forest")
        }
    }

    init(alternateIconName: String?) {
        self = Self.allCases.first { $0.alternateIconName == alternateIconName } ?? .standard
    }
}
