import SwiftUI
import AVKit
import AVFoundation

// MARK: - CapsuleMediaGallery

/// Everything that travelled inside the letter besides its words: photos in a
/// gently paging carousel (tap for a full-screen, zoomable viewer), videos as
/// posters that play full screen, and voice notes with a small waveform.
struct CapsuleMediaGallery: View {
    let capsule: TimeCapsule

    private var photos: [CapsuleMedia] {
        capsule.sortedMedia.filter { $0.kind == .photo }
    }

    private var videos: [CapsuleMedia] {
        capsule.sortedMedia.filter { $0.kind == .video }
    }

    private var voiceNotes: [CapsuleMedia] {
        capsule.sortedMedia.filter { $0.kind == .audio }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            if !photos.isEmpty {
                CapsuleMediaPhotoSection(photos: photos)
            }
            if !videos.isEmpty {
                CapsuleMediaVideoSection(videos: videos)
            }
            if !voiceNotes.isEmpty {
                CapsuleMediaVoiceSection(notes: voiceNotes)
            }
        }
    }
}

// MARK: - Photos

private struct CapsuleMediaPhotoSection: View {
    let photos: [CapsuleMedia]

    @Environment(\.theme) private var theme
    @State private var viewer: CapsuleMediaViewerStart?

    var body: some View {
        Group {
            if photos.count == 1, let photo = photos.first {
                photoCard(photo, aspect: 4.0 / 3.0)
                    .padding(.horizontal, 20)
            } else {
                carousel
            }
        }
        .fullScreenCover(item: $viewer) { start in
            CapsuleMediaPhotoViewer(photos: photos, startID: start.id)
        }
    }

    private var carousel: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 14) {
                ForEach(photos, id: \.id) { photo in
                    photoCard(photo, aspect: 4.0 / 5.0)
                        .containerRelativeFrame(.horizontal) { length, _ in
                            length * 0.72
                        }
                        .scrollTransition(axis: .horizontal) { content, phase in
                            content
                                .scaleEffect(phase.isIdentity ? 1 : 0.93)
                                .opacity(phase.isIdentity ? 1 : 0.7)
                        }
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, 24, for: .scrollContent)
    }

    private func photoCard(_ photo: CapsuleMedia, aspect: CGFloat) -> some View {
        Button {
            Haptics.tap()
            viewer = CapsuleMediaViewerStart(id: photo.id)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                CapsuleMediaFrame(media: photo, aspect: aspect)
                if !photo.caption.isEmpty {
                    Text(photo.caption)
                        .font(theme.body(14).italic())
                        .foregroundStyle(theme.inkSecondary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                }
            }
        }
        .buttonStyle(CapsuleMediaPressStyle())
        .accessibilityLabel(photo.caption.isEmpty ? Text("Photo") : Text(photo.caption))
        .accessibilityHint(Text("Opens full screen"))
    }
}

// MARK: - Videos

private struct CapsuleMediaVideoSection: View {
    let videos: [CapsuleMedia]

    @Environment(\.theme) private var theme
    @State private var playing: CapsuleMediaVideoItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(videos, id: \.id) { video in
                videoCard(video)
            }
        }
        .padding(.horizontal, 20)
        .fullScreenCover(item: $playing) { item in
            CapsuleMediaVideoScreen(url: item.url)
        }
    }

    private func videoCard(_ video: CapsuleMedia) -> some View {
        Button {
            guard let url = MediaStore.url(for: video) else { return }
            Haptics.tap()
            playing = CapsuleMediaVideoItem(id: video.id, url: url)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                CapsuleMediaFrame(media: video, aspect: 16.0 / 9.0)
                    .overlay(alignment: .bottomTrailing) {
                        durationPill(video.duration)
                    }
                if !video.caption.isEmpty {
                    Text(video.caption)
                        .font(theme.body(14).italic())
                        .foregroundStyle(theme.inkSecondary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                }
            }
        }
        .buttonStyle(CapsuleMediaPressStyle())
        .accessibilityLabel(video.caption.isEmpty ? Text("Video") : Text(video.caption))
        .accessibilityHint(Text("Plays full screen"))
    }

    @ViewBuilder
    private func durationPill(_ seconds: Double) -> some View {
        if seconds > 0 {
            Text(capsuleMediaClock(seconds))
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color.white)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(Color.black.opacity(0.45), in: Capsule())
                .padding(10)
        }
    }
}

// MARK: - Voice notes

private struct CapsuleMediaVoiceSection: View {
    let notes: [CapsuleMedia]

    var body: some View {
        VStack(spacing: 12) {
            ForEach(notes, id: \.id) { note in
                if let url = MediaStore.url(for: note) {
                    CapsuleMediaVoiceRow(
                        url: url,
                        storedDuration: note.duration,
                        caption: note.caption,
                        seed: capsuleMediaSeed(note.fileName)
                    )
                }
            }
        }
        .padding(.horizontal, 20)
    }
}

private struct CapsuleMediaVoiceRow: View {
    let url: URL
    let storedDuration: Double
    let caption: String
    let seed: Int

    @Environment(\.theme) private var theme
    @State private var playback = AudioPlayback()

    var body: some View {
        HStack(spacing: 16) {
            playButton
            VStack(alignment: .leading, spacing: 8) {
                CapsuleMediaWaveform(
                    seed: seed,
                    progress: playback.progress,
                    played: theme.accent,
                    pending: theme.inkSecondary.opacity(0.35)
                )
                .frame(height: 30)
                details
            }
        }
        .themedCard(padding: 16)
        .onAppear {
            playback.load(url)
        }
        .onDisappear {
            playback.stop()
        }
    }

    private var details: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(theme.label(12, weight: .semibold))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(timeLabel)
                .font(theme.label(12))
                .monospacedDigit()
                .foregroundStyle(theme.inkSecondary)
        }
    }

    private var playButton: some View {
        Button {
            Haptics.tap()
            playback.toggle()
        } label: {
            Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.accentInk)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 46, height: 46)
                .background(theme.accent, in: Circle())
                .shadow(color: theme.glow.opacity(0.55), radius: playback.isPlaying ? 10 : 0)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playback.isPlaying ? Text("Pause voice note") : Text("Play voice note"))
    }

    private var title: String {
        caption.isEmpty ? String(localized: "Voice note") : caption
    }

    private var totalDuration: Double {
        playback.duration > 0 ? playback.duration : storedDuration
    }

    private var timeLabel: String {
        if playback.isPlaying || playback.progress > 0 {
            return "\(capsuleMediaClock(playback.progress * totalDuration)) / \(capsuleMediaClock(totalDuration))"
        }
        return capsuleMediaClock(totalDuration)
    }
}

/// A deterministic, waveform-like bar graph that fills with colour as it plays.
private struct CapsuleMediaWaveform: View {
    let seed: Int
    let progress: Double
    let played: Color
    let pending: Color

    var body: some View {
        Canvas { context, size in
            let count = 44
            let gap: CGFloat = 2.5
            let barWidth = max(1, (size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            for index in 0..<count {
                let level = capsuleMediaLevel(index: index, count: count, seed: seed)
                let height = max(3, size.height * level)
                let rect = CGRect(
                    x: CGFloat(index) * (barWidth + gap),
                    y: (size.height - height) / 2,
                    width: barWidth,
                    height: height
                )
                let isPlayed = (Double(index) + 0.5) / Double(count) <= progress
                context.fill(
                    Path(roundedRect: rect, cornerRadius: barWidth / 2),
                    with: .color(isPlayed ? played : pending)
                )
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Shared frame

/// A rounded, softly shadowed frame of a fixed aspect ratio holding a thumbnail.
private struct CapsuleMediaFrame: View {
    let media: CapsuleMedia
    let aspect: CGFloat

    @Environment(\.theme) private var theme

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: max(theme.cornerRadius, 8), style: .continuous)
    }

    var body: some View {
        Color.clear
            .aspectRatio(aspect, contentMode: .fit)
            .overlay {
                thumbnail
            }
            .clipShape(shape)
            .overlay {
                shape.strokeBorder(theme.surfaceStroke, lineWidth: 0.5)
            }
            .shadow(color: Color.black.opacity(theme.colorScheme == .dark ? 0.35 : 0.12), radius: 14, y: 8)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let url = MediaStore.url(for: media) {
            MediaThumbnailView(url: url, kind: media.kind)
        } else {
            ZStack {
                theme.surface
                Image(systemName: media.kind.symbolName)
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(theme.inkSecondary)
            }
        }
    }
}

private struct CapsuleMediaPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

// MARK: - Full-screen photo viewer

private struct CapsuleMediaPhotoViewer: View {
    let photos: [CapsuleMedia]

    @Environment(\.dismiss) private var dismiss
    @State private var selection: UUID

    init(photos: [CapsuleMedia], startID: UUID) {
        self.photos = photos
        _selection = State(initialValue: startID)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black
                .ignoresSafeArea()
            pager
            CapsuleMediaCloseButton {
                dismiss()
            }
        }
        .environment(\.colorScheme, .dark)
        .statusBarHidden()
    }

    private var pager: some View {
        TabView(selection: $selection) {
            ForEach(photos, id: \.id) { photo in
                CapsuleMediaZoomablePhoto(url: MediaStore.url(for: photo), caption: photo.caption)
                    .tag(photo.id as UUID)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .automatic : .never))
        .ignoresSafeArea()
    }
}

/// One page of the viewer: pinch to zoom (MagnifyGesture), drag to pan while
/// zoomed, double-tap to toggle. Paging stays free while not zoomed.
private struct CapsuleMediaZoomablePhoto: View {
    let url: URL?
    let caption: String

    @State private var image: UIImage?
    @State private var scale: CGFloat = 1
    @State private var settledScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var settledOffset: CGSize = .zero

    private var isZoomed: Bool {
        scale > 1.01
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            photo
            if !caption.isEmpty && !isZoomed {
                captionView
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: isZoomed)
        .task(id: url) {
            await load()
        }
    }

    @ViewBuilder
    private var photo: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .scaleEffect(scale)
                .offset(offset)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .onTapGesture(count: 2) {
                    toggleZoom()
                }
                .simultaneousGesture(magnify)
                .gesture(pan, including: isZoomed ? .all : .subviews)
                .accessibilityLabel(caption.isEmpty ? Text("Photo") : Text(caption))
        } else {
            ProgressView()
                .tint(Color.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var captionView: some View {
        Text(caption)
            .font(.system(size: 15, design: .serif).italic())
            .foregroundStyle(Color.white.opacity(0.9))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 28)
            .padding(.top, 44)
            .padding(.bottom, 56)
            .frame(maxWidth: .infinity)
            .background {
                LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
            }
            .allowsHitTesting(false)
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(max(settledScale * value.magnification, 1), 5)
            }
            .onEnded { _ in
                settledScale = scale
                if scale <= 1.01 {
                    withAnimation(.smooth(duration: 0.3)) {
                        resetZoom()
                    }
                }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: settledOffset.width + value.translation.width,
                    height: settledOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                settledOffset = offset
            }
    }

    private func toggleZoom() {
        withAnimation(.spring(duration: 0.4, bounce: 0.15)) {
            if isZoomed {
                resetZoom()
            } else {
                scale = 2.5
                settledScale = 2.5
            }
        }
    }

    private func resetZoom() {
        scale = 1
        settledScale = 1
        offset = .zero
        settledOffset = .zero
    }

    private func load() async {
        guard image == nil, let url else { return }
        image = await MediaStore.thumbnail(for: url, kind: .photo, maxPixelSize: 2400)
    }
}

// MARK: - Full-screen video

private struct CapsuleMediaVideoScreen: View {
    let url: URL

    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer

    init(url: URL) {
        self.url = url
        _player = State(initialValue: AVPlayer(url: url))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                CapsuleMediaCloseButton {
                    dismiss()
                }
                Spacer()
            }
            VideoPlayer(player: player)
        }
        .background(Color.black.ignoresSafeArea())
        .environment(\.colorScheme, .dark)
        .onAppear {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            player.play()
        }
        .onDisappear {
            player.pause()
        }
    }
}

private struct CapsuleMediaCloseButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: 38, height: 38)
                .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 20)
        .padding(.vertical, 8)
        .accessibilityLabel(Text("Close"))
    }
}

// MARK: - Helpers

private struct CapsuleMediaViewerStart: Identifiable {
    let id: UUID
}

private struct CapsuleMediaVideoItem: Identifiable {
    let id: UUID
    let url: URL
}

/// "1:05" style clock for media durations.
private func capsuleMediaClock(_ seconds: Double) -> String {
    let value = seconds.isFinite ? max(0, seconds) : 0
    return Duration.seconds(value).formatted(.time(pattern: .minuteSecond))
}

/// A stable seed per file so a voice note always draws the same waveform.
private func capsuleMediaSeed(_ name: String) -> Int {
    name.unicodeScalars.reduce(7) { ($0 &* 31) &+ Int($1.value) }
}

/// Deterministic bar height (0...1) with a gentle taper at both ends.
private func capsuleMediaLevel(index: Int, count: Int, seed: Int) -> CGFloat {
    var x = UInt64(bitPattern: Int64(seed &* 2_654_435_761 &+ index &* 40_503))
    x ^= x >> 33
    x &*= 0xff51afd7ed558ccd
    x ^= x >> 33
    let noise = Double(x % 1000) / 1000
    let taper = sin(Double(index + 1) / Double(count + 1) * Double.pi)
    return CGFloat(0.22 + 0.78 * noise * (0.45 + 0.55 * taper))
}
