import SwiftUI
import UIKit

/// An asynchronously loaded thumbnail that fills (and is clipped to) its frame.
/// Photos and videos show their picture (videos with a small play badge);
/// voice notes show a waveform on the style's accent, tinted by its signature gradient.
struct MediaThumbnailView: View {
    private let url: URL
    private let kind: MediaKind
    private let maxPixelSize: CGFloat

    @State private var image: UIImage?
    @State private var loadedRequest: MediaThumbnailRequest?

    /// - Parameter maxPixelSize: the longest side, in pixels, the decoded picture needs.
    ///   Small grid tiles can ask for less to save memory and decoding time.
    init(url: URL, kind: MediaKind, maxPixelSize: CGFloat = 600) {
        self.url = url
        self.kind = kind
        self.maxPixelSize = maxPixelSize
    }

    private var request: MediaThumbnailRequest {
        MediaThumbnailRequest(url: url, maxPixelSize: maxPixelSize)
    }

    private var accessibilityName: Text {
        switch kind {
        case .photo: return Text("Photo")
        case .video: return Text("Video")
        case .audio: return Text("Voice note")
        }
    }

    var body: some View {
        Color.clear
            .overlay { picture }
            .overlay { badge }
            .clipped()
            .contentShape(Rectangle())
            .task(id: request) {
                await loadThumbnail(request)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityName)
            .accessibilityAddTraits(.isImage)
    }

    @ViewBuilder
    private var picture: some View {
        if kind == .audio {
            MediaThumbnailAudioFace()
        } else if let image, loadedRequest == request {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .transition(.opacity)
        } else {
            MediaThumbnailPlaceholder(symbol: kind.symbolName)
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var badge: some View {
        if kind == .video {
            MediaThumbnailPlayBadge()
        }
    }

    private func loadThumbnail(_ request: MediaThumbnailRequest) async {
        guard kind != .audio else { return }
        let loaded = await MediaStore.thumbnail(for: request.url, kind: kind, maxPixelSize: request.maxPixelSize)
        guard !Task.isCancelled else { return }
        withAnimation(.easeOut(duration: 0.3)) {
            image = loaded
            loadedRequest = request
        }
    }
}

/// What a thumbnail was decoded for; a new file or a new size loads it again.
private struct MediaThumbnailRequest: Hashable {
    let url: URL
    let maxPixelSize: CGFloat
}

// MARK: - Faces

private struct MediaThumbnailPlaceholder: View {
    @Environment(\.theme) private var theme

    let symbol: String

    var body: some View {
        ZStack {
            theme.surface
            LinearGradient(
                colors: [Color.white.opacity(theme.colorScheme == .dark ? 0.05 : 0.2), Color.white.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(theme.inkSecondary)
        }
    }
}

private struct MediaThumbnailAudioFace: View {
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack {
            Rectangle()
                .fill(theme.accent)
            // Only a whisper of the signature gradient, so the glyph keeps at least
            // 3:1 against the tile in every style (accentInk is made for accent).
            Rectangle()
                .fill(theme.linearGradient)
                .opacity(0.2)
            Image(systemName: "waveform")
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(theme.accentInk)
        }
    }
}

private struct MediaThumbnailPlayBadge: View {
    var body: some View {
        Image(systemName: "play.fill")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color.white)
            .offset(x: 1)
            .frame(width: 32, height: 32)
            .background(.ultraThinMaterial, in: Circle())
            .overlay {
                Circle().strokeBorder(Color.white.opacity(0.3), lineWidth: 0.5)
            }
            .environment(\.colorScheme, .dark)
            .shadow(color: Color.black.opacity(0.25), radius: 6, x: 0, y: 2)
    }
}

// MARK: - Previews

#Preview("Media thumbnails") {
    HStack(spacing: 10) {
        ForEach(MediaKind.allCases) { kind in
            MediaThumbnailView(url: URL(fileURLWithPath: "/dev/null/\(kind.rawValue)"), kind: kind)
                .frame(width: 104, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
    .padding(24)
    .background { ThemeBackground() }
    .theme(.blossom)
}
