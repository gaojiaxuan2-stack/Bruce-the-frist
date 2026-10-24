import SwiftUI
import UIKit

/// A grid of home-screen icons. The classic icon is always free; the alternates are a Pro perk, so tapping one
/// without Pro opens the paywall instead.
struct AppIconPicker: View {
    @Environment(Store.self) private var store
    @Environment(AppRouter.self) private var router
    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 60

    @State private var selection: AppIconOption = .standard
    /// The icon being switched to, while iOS applies it.
    @State private var pendingOption: AppIconOption?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if UIApplication.shared.supportsAlternateIcons {
                iconGrid
            } else {
                Text("This device can't change Unhook's icon.")
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear {
            syncSelection()
        }
        .alert("Couldn't change the icon", isPresented: isShowingError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var iconGrid: some View {
        LazyVGrid(columns: columns, spacing: 16) {
            ForEach(AppIconOption.allCases) { option in
                iconButton(for: option)
            }
        }
        .padding(.vertical, 8)
    }

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: iconSize + 16), spacing: 12)]
    }

    // MARK: Cells

    private func iconButton(for option: AppIconOption) -> some View {
        let isSelected = option == selection
        let isLocked = requiresPro(option)
        return Button {
            select(option)
        } label: {
            VStack(spacing: 8) {
                iconImage(for: option, isSelected: isSelected, isLocked: isLocked)
                Text(option.title)
                    .font(.caption.weight(isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color.primary : Color.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        // Plain style keeps each icon its own tap target inside the Form row.
        .buttonStyle(.plain)
        .disabled(pendingOption != nil)
        .accessibilityValue(accessibilityValue(isSelected: isSelected, isLocked: isLocked))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func iconImage(for option: AppIconOption, isSelected: Bool, isLocked: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: iconSize * 0.22, style: .continuous)
        return Image(option.previewImageName)
            .resizable()
            .scaledToFit()
            .frame(width: iconSize, height: iconSize)
            .clipShape(shape)
            .overlay {
                shape.strokeBorder(
                    isSelected ? Color.accentColor : Color.primary.opacity(0.1),
                    lineWidth: isSelected ? 3 : 1
                )
            }
            .overlay {
                if pendingOption == option {
                    ProgressView()
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                }
            }
            .overlay(alignment: .topTrailing) {
                if isLocked {
                    lockBadge
                        .offset(x: 6, y: -6)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if isSelected {
                    checkmarkBadge
                        .offset(x: 6, y: 6)
                }
            }
            .padding(6)
            .accessibilityHidden(true)
    }

    private var lockBadge: some View {
        Image(systemName: "lock.fill")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .padding(5)
            .background(Brand.gradient, in: Circle())
            .overlay(Circle().stroke(Color(.secondarySystemGroupedBackground), lineWidth: 2))
    }

    private var checkmarkBadge: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.title3)
            .symbolRenderingMode(.palette)
            .foregroundStyle(.white, Color.accentColor)
            .background(Circle().fill(Color(.secondarySystemGroupedBackground)).padding(-2))
    }

    // MARK: State

    private var isShowingError: Binding<Bool> {
        Binding {
            errorMessage != nil
        } set: { isPresented in
            if !isPresented {
                errorMessage = nil
            }
        }
    }

    private func requiresPro(_ option: AppIconOption) -> Bool {
        option != .standard && !store.isPro
    }

    private func accessibilityValue(isSelected: Bool, isLocked: Bool) -> String {
        if isSelected {
            return String(localized: "Current icon")
        }
        if isLocked {
            return String(localized: "Requires Unhook Pro")
        }
        return ""
    }

    private func syncSelection() {
        selection = AppIconOption(alternateIconName: UIApplication.shared.alternateIconName)
    }

    // MARK: Actions

    private func select(_ option: AppIconOption) {
        guard option != selection, pendingOption == nil else { return }
        guard !requiresPro(option) else {
            Haptics.tap()
            router.showPaywall(.appIcons)
            return
        }
        Haptics.selection()
        pendingOption = option
        Task { await apply(option) }
    }

    private func apply(_ option: AppIconOption) async {
        do {
            try await UIApplication.shared.setAlternateIconName(option.alternateIconName)
            selection = option
        } catch {
            errorMessage = error.localizedDescription
            syncSelection()
        }
        pendingOption = nil
    }
}

#Preview {
    Form {
        Section("App icon") {
            AppIconPicker()
        }
    }
    .previewEnvironment()
}
