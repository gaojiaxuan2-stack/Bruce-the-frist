import Foundation
import AVFoundation
import Observation

// MARK: - VoiceRecorder

/// Records a voice note as AAC `.m4a` into a temporary file and publishes a short history of
/// input levels, so the UI can draw a calm, living waveform while the user speaks.
///
/// Recording stops on its own after `maxDuration` (or when the system interrupts it);
/// `isRecording` then turns `false` and the captured file is still collected with `stop()`.
@MainActor
@Observable
final class VoiceRecorder {
    /// `true` while the microphone is capturing.
    private(set) var isRecording = false
    /// Seconds captured so far; kept after stopping so the UI can show the final length.
    private(set) var elapsed: TimeInterval = 0
    /// The most recent normalized input levels (0...1), oldest first, at most 48.
    private(set) var levels: [CGFloat] = []
    /// `true` when microphone access was declined.
    private(set) var permissionDenied = false
    /// Recording stops automatically after five minutes.
    let maxDuration: TimeInterval = 300

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var fileURL: URL?
    @ObservationIgnored private var meterTask: Task<Void, Never>?
    @ObservationIgnored private var isPreparing = false

    private static let levelCapacity = 48

    init() {}

    /// Asks for microphone permission (if needed) and starts a fresh recording.
    /// Any previous recording that was never collected with `stop()` is discarded.
    func start() async {
        guard !isRecording, !isPreparing else { return }
        isPreparing = true
        defer { isPreparing = false }

        let granted = await AVAudioApplication.requestRecordPermission()
        permissionDenied = !granted
        guard granted else { return }

        discardPendingFile()
        elapsed = 0
        levels = []

        guard activateSession() else { return }

        let destination = FileManager.default.temporaryDirectory
            .appending(component: "voice-\(UUID().uuidString).m4a", directoryHint: .notDirectory)
        do {
            let newRecorder = try AVAudioRecorder(url: destination, settings: Self.recordingSettings)
            newRecorder.isMeteringEnabled = true
            guard newRecorder.prepareToRecord(), newRecorder.record() else {
                try? FileManager.default.removeItem(at: destination)
                deactivateSession()
                return
            }
            recorder = newRecorder
            fileURL = destination
            isRecording = true
            startMetering()
        } catch {
            try? FileManager.default.removeItem(at: destination)
            deactivateSession()
        }
    }

    /// Stops recording (if needed) and hands over the recorded temporary file.
    /// The caller owns the file afterwards (e.g. `MediaStore.moveFile`).
    @discardableResult
    func stop() -> URL? {
        finishCapture()
        guard let captured = fileURL else { return nil }
        fileURL = nil
        guard FileManager.default.fileExists(atPath: captured.path(percentEncoded: false)) else { return nil }
        return captured
    }

    /// Stops recording and deletes whatever was captured.
    func cancel() {
        finishCapture()
        discardPendingFile()
        elapsed = 0
        levels = []
    }

    // MARK: Private

    private static var recordingSettings: [String: Any] {
        [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
    }

    private func activateSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            return true
        } catch {
            return false
        }
    }

    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startMetering() {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                guard !Task.isCancelled, let self else { return }
                self.sampleMeters()
            }
        }
    }

    private func sampleMeters() {
        guard let recorder else { return }
        guard recorder.isRecording else {
            // Interrupted by the system (a call, Siri…): keep what was captured.
            finishCapture()
            return
        }
        recorder.updateMeters()
        let captured = recorder.currentTime
        elapsed = min(captured, maxDuration)
        appendLevel(Self.normalizedLevel(recorder.averagePower(forChannel: 0)))
        if captured >= maxDuration {
            finishCapture()
        }
    }

    /// Appends a level with a quick attack and a softer release, so the waveform
    /// rises with the voice and settles gracefully in pauses.
    private func appendLevel(_ value: CGFloat) {
        let previous = levels.last ?? 0
        let smoothed = value > previous
            ? value * 0.8 + previous * 0.2
            : value * 0.55 + previous * 0.45
        var next = levels
        next.append(min(max(smoothed, 0), 1))
        if next.count > Self.levelCapacity {
            next.removeFirst(next.count - Self.levelCapacity)
        }
        levels = next
    }

    /// Maps average power (−60…0 dB) to 0…1 with a gentle ease-in curve that keeps
    /// room noise low and lets speech breathe.
    private static func normalizedLevel(_ decibels: Float) -> CGFloat {
        guard decibels.isFinite else { return 0 }
        let floorDB: Double = -60
        let clamped = min(max(Double(decibels), floorDB), 0)
        let linear = (clamped - floorDB) / -floorDB
        return CGFloat(pow(linear, 1.7))
    }

    private func finishCapture() {
        meterTask?.cancel()
        meterTask = nil
        guard let activeRecorder = recorder else { return }
        let captured = activeRecorder.currentTime
        if captured > 0 {
            elapsed = min(captured, maxDuration)
        }
        activeRecorder.stop()
        recorder = nil
        isRecording = false
        deactivateSession()
    }

    private func discardPendingFile() {
        if let pending = fileURL {
            try? FileManager.default.removeItem(at: pending)
        }
        fileURL = nil
    }
}

// MARK: - AudioPlayback

/// Plays a single voice note with observable progress, for a quiet, elegant audio row.
@MainActor
@Observable
final class AudioPlayback {
    /// `true` while audio is audible.
    private(set) var isPlaying = false
    /// Playback position, 0...1.
    private(set) var progress: Double = 0
    /// Length of the loaded file in seconds (0 when nothing is loaded).
    private(set) var duration: TimeInterval = 0

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var progressTask: Task<Void, Never>?
    @ObservationIgnored private var ownsSession = false
    @ObservationIgnored private let finishRelay = VoiceRecorderPlaybackRelay()

    init() {
        finishRelay.onFinish = { [weak self] in
            self?.playerDidFinish()
        }
    }

    /// Prepares a file for playback. Loading the file that is already loaded keeps its state.
    func load(_ url: URL) {
        if let current = player, current.url == url { return }
        stop()
        player = nil
        progress = 0
        duration = 0
        guard let newPlayer = try? AVAudioPlayer(contentsOf: url) else { return }
        newPlayer.delegate = finishRelay
        newPlayer.prepareToPlay()
        player = newPlayer
        let length = newPlayer.duration
        duration = length.isFinite ? max(length, 0) : 0
    }

    /// Plays or pauses. After reaching the end, playing starts again from the beginning.
    func toggle() {
        guard let player else { return }
        if player.isPlaying {
            pause(player)
        } else {
            play(player)
        }
    }

    /// Stops and rewinds to the beginning.
    func stop() {
        stopProgressUpdates()
        if let player {
            player.stop()
            player.currentTime = 0
        }
        isPlaying = false
        progress = 0
        releaseSession()
    }

    // MARK: Private

    private func play(_ player: AVAudioPlayer) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            ownsSession = true
        } catch {
            // Still try to play through whatever route is current.
        }
        if player.duration > 0, player.currentTime >= player.duration - 0.05 {
            player.currentTime = 0
        }
        guard player.play() else {
            releaseSession()
            return
        }
        isPlaying = true
        startProgressUpdates()
    }

    private func pause(_ player: AVAudioPlayer) {
        player.pause()
        isPlaying = false
        stopProgressUpdates()
        updateProgress()
        releaseSession()
    }

    private func startProgressUpdates() {
        progressTask?.cancel()
        progressTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                guard !Task.isCancelled, let self else { return }
                self.tick()
            }
        }
    }

    private func stopProgressUpdates() {
        progressTask?.cancel()
        progressTask = nil
    }

    private func tick() {
        guard let player else { return }
        updateProgress()
        if isPlaying, !player.isPlaying {
            // Paused by the system (interruption, headphones unplugged…).
            isPlaying = false
            stopProgressUpdates()
            releaseSession()
        }
    }

    private func updateProgress() {
        guard let player, duration > 0 else {
            progress = 0
            return
        }
        progress = min(max(player.currentTime / duration, 0), 1)
    }

    private func playerDidFinish() {
        guard let player, !player.isPlaying else { return }
        stopProgressUpdates()
        player.currentTime = 0
        isPlaying = false
        progress = 0
        releaseSession()
    }

    private func releaseSession() {
        guard ownsSession else { return }
        ownsSession = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - Private delegate

/// Bridges `AVAudioPlayerDelegate` callbacks (which need an `NSObject`) back to the main actor,
/// so `AudioPlayback` can stay a plain `@Observable` class.
private final class VoiceRecorderPlaybackRelay: NSObject, AVAudioPlayerDelegate {
    var onFinish: (@MainActor @Sendable () -> Void)?

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        notifyFinished()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        notifyFinished()
    }

    private func notifyFinished() {
        guard let handler = onFinish else { return }
        Task { @MainActor in
            handler()
        }
    }
}
