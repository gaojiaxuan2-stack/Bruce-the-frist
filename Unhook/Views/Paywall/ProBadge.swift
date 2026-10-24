import SwiftUI

/// A small "PRO" capsule for marking Pro features, for example in Settings rows or on locked insights.
struct ProBadge: View {
    var body: some View {
        Text("PRO")
            .font(.caption2.weight(.heavy))
            .tracking(0.6)
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Brand.gradient, in: Capsule())
            .fixedSize()
            .accessibilityLabel("Unhook Pro")
    }
}

#Preview {
    List {
        Label {
            HStack {
                Text("App Icon")
                Spacer()
                ProBadge()
            }
        } icon: {
            Image(systemName: "app.badge.fill")
        }
    }
    .previewEnvironment()
}
