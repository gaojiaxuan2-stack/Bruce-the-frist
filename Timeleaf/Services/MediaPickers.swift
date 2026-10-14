import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - CameraPicker

/// The system camera, capturing either a photo or a video (up to ten minutes).
///
/// Present it full screen and dismiss it from `onComplete`, which is called exactly once,
/// on the main thread:
/// ```swift
/// .fullScreenCover(isPresented: $showsCamera) {
///     CameraPicker { output in
///         showsCamera = false
///         // handle output
///     }
///     .ignoresSafeArea()
/// }
/// ```
struct CameraPicker: UIViewControllerRepresentable {
    /// What the camera produced. A video URL is a temporary copy owned by the caller.
    enum Output {
        case photo(UIImage)
        case video(URL)
    }

    /// `false` on devices without a camera (e.g. the Simulator).
    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    /// Called with the captured media, or `nil` when the user cancels.
    var onComplete: (Output?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onComplete: onComplete)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.delegate = context.coordinator
        let wanted = [UTType.image.identifier, UTType.movie.identifier]
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            // No camera (Simulator): fall back to the library so the flow still works.
            picker.mediaTypes = wanted
            return picker
        }
        picker.sourceType = .camera
        let available = UIImagePickerController.availableMediaTypes(for: .camera) ?? []
        let mediaTypes = wanted.filter { available.contains($0) }
        picker.mediaTypes = mediaTypes.isEmpty ? [UTType.image.identifier] : mediaTypes
        picker.videoQuality = .typeHigh
        picker.videoMaximumDuration = 600
        let canTakePhotos = picker.mediaTypes.contains(UTType.image.identifier)
        picker.cameraCaptureMode = canTakePhotos ? .photo : .video
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {
        context.coordinator.onComplete = onComplete
    }

    /// Receives the picker's delegate callbacks.
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        var onComplete: (CameraPicker.Output?) -> Void
        private var hasCompleted = false

        init(onComplete: @escaping (CameraPicker.Output?) -> Void) {
            self.onComplete = onComplete
            super.init()
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            // The picker deletes its movie file as soon as this returns, so copy it first.
            deliver(makeOutput(from: info))
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            deliver(nil)
        }

        private func makeOutput(from info: [UIImagePickerController.InfoKey: Any]) -> CameraPicker.Output? {
            if let movieURL = info[.mediaURL] as? URL {
                guard let copy = try? mediaPickersTemporaryCopy(of: movieURL) else { return nil }
                return .video(copy)
            }
            if let image = (info[.editedImage] as? UIImage) ?? (info[.originalImage] as? UIImage) {
                return .photo(image)
            }
            return nil
        }

        private func deliver(_ output: CameraPicker.Output?) {
            guard !hasCompleted else { return }
            hasCompleted = true
            let handler = onComplete
            if Thread.isMainThread {
                handler(output)
            } else {
                DispatchQueue.main.async {
                    handler(output)
                }
            }
        }
    }
}

// MARK: - PickedMovie

/// A video chosen with `PhotosPicker`, copied into a temporary file the caller owns:
/// `try await item.loadTransferable(type: PickedMovie.self)`.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            // The received file is only valid during this closure.
            let copy = try mediaPickersTemporaryCopy(of: received.file)
            return PickedMovie(url: copy)
        }
    }
}

// MARK: - Private

/// Copies a movie to `<tmp>/<uuid>.<ext>` (defaulting to `.mov`).
private func mediaPickersTemporaryCopy(of source: URL) throws -> URL {
    let pathExtension = source.pathExtension.lowercased()
    let ext = pathExtension.isEmpty ? "mov" : pathExtension
    let destination = FileManager.default.temporaryDirectory
        .appending(component: "\(UUID().uuidString).\(ext)", directoryHint: .notDirectory)
    try FileManager.default.copyItem(at: source, to: destination)
    return destination
}
