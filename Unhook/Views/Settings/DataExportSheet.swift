import SwiftUI

/// The files made by "Export my data".
struct DataExportFiles: Identifiable {
    /// The complete JSON export.
    let json: URL
    /// The same history as a spreadsheet timeline, when it could be written.
    let csv: URL?

    var id: URL { json }
}

/// Shown after "Export my data": what's in the export and buttons to share or save it through the share sheet.
struct DataExportSheet: View {
    let files: DataExportFiles

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header
                    fileRow
                    shareButtons
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(Color(.systemGroupedBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.seal.fill")
                .font(.largeTitle)
                .foregroundStyle(Brand.gradient)
                .accessibilityHidden(true)
            Text("Your data is ready")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Every habit, slip, craving, pledge and savings goal in one file. It stays on your device until you choose where to send it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var fileRow: some View {
        Label {
            Text(files.json.lastPathComponent)
                .font(.footnote.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
        } icon: {
            Image(systemName: "doc.text.fill")
                .foregroundStyle(Brand.gradient)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var shareButtons: some View {
        VStack(spacing: 12) {
            ShareLink(item: files.json) {
                Label("Share or save file", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(PrimaryButtonStyle())

            if let csv = files.csv {
                ShareLink(item: csv) {
                    Label("Spreadsheet version (CSV)", systemImage: "tablecells")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }
}

#Preview {
    DataExportSheet(files: DataExportFiles(
        json: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("Unhook-Export-2026-10-24.json"),
        csv: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("Unhook-Export-2026-10-24.csv")
    ))
    .previewEnvironment()
}
