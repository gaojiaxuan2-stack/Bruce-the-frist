import SwiftUI
import UIKit

/// An asynchronously loaded thumbnail that fills (and is clipped to) its frame.
/// Photos and videos show their picture (videos with a small play badge);
/// voice notes show a waveform on the style's signature gradient.
struct MediaThumbnailView: View {
    private let url: URL
    private let kind: MediaKind

    @State private var image: UIImage?
    @State private var imageURL: URL?

    init(url: URL, kind: MediaKind) {
        self.url = url
        self.kind = kind
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
            .task(id: url) {
                await loadThumbnail()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityName)
            .accessibilityAddTraits(.isImage)
    }

    @ViewBuilder
    private var picture: some View {
        if kind == .audio {
            MediaThumbnailAudioFace()
        } else if let image, imageURL == url {
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

    private func loadThumbnail() async {
        guard kind != .audio else { return }
        let loaded = await MediaStore.thumbnail(for: url, kind: kind)
        guard !Task.isCancelled else { return }
        withAnimation(.easeOut(duration: 0.3)) {
            image = loaded
            imageURL = url
        }
    }
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
                .fill(theme.linearGradient)
            Image(systemName: "waveform")
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(Color.white.opacity(0.95))
                .shadow(color: Color.black.opacity(0.28), radius: 6, x: 0, y: 2)
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
