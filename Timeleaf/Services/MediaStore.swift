import Foundation
import UIKit
import ImageIO
import AVFoundation

/// The on-disk home for every photo, video and voice note sealed inside a capsule.
///
/// Layout, inside the app's Application Support directory (kept in device backups —
/// these memories are precious):
/// ```
/// Timeleaf/
///   Media/<capsule-uuid>/<file-uuid>.<ext>
///   Inbox/<package>.timeleaf
/// ```
/// Letters are private, so the media and inbox directories and every file written here use
/// `FileProtectionType.complete`. All functions are thread-safe and never crash on missing files.
enum MediaStore {

    // MARK: - Locations

    /// `<Application Support>/Timeleaf/Media`, created on demand.
    static var rootURL: URL {
        let location = mediaRootLocation
        prepareDirectory(location)
        return location
    }

    /// `<Application Support>/Timeleaf/Inbox` — received `.timeleaf` packages, created on demand.
    static var inboxURL: URL {
        let location = baseLocation.appending(path: "Inbox", directoryHint: .isDirectory)
        prepareDirectory(location)
        return location
    }

    /// The folder holding one capsule's media, created on demand.
    static func directory(for capsuleID: UUID) -> URL {
        let location = capsuleLocation(capsuleID)
        prepareDirectory(location)
        return location
    }

    /// Location of a media file belonging to a capsule (the file itself may not exist).
    static func url(capsuleID: UUID, fileName: String) -> URL {
        directory(for: capsuleID).appending(component: fileName, directoryHint: .notDirectory)
    }

    /// Location of a stored media item, or `nil` while it is not attached to a capsule.
    static func url(for media: CapsuleMedia) -> URL? {
        guard let capsule = media.capsule else { return nil }
        return url(capsuleID: capsule.id, fileName: media.fileName)
    }

    // MARK: - Writing

    /// Writes `data` as a new protected file and returns its name, `"<uuid>.<ext>"`.
    static func save(_ data: Data, capsuleID: UUID, fileExtension: String) throws -> String {
        let name = makeFileName(fileExtension: fileExtension)
        let destination = url(capsuleID: capsuleID, fileName: name)
        try data.write(to: destination, options: [.atomic, .completeFileProtection])
        return name
    }

    /// Copies a file into the capsule's folder, keeping its (lowercased) extension.
    /// Handles security-scoped URLs. Returns the new file name.
    static func copyFile(at sourceURL: URL, capsuleID: UUID) throws -> String {
        let isScoped = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if isScoped { sourceURL.stopAccessingSecurityScopedResource() }
        }
        let name = makeFileName(fileExtension: sourceURL.pathExtension)
        let destination = url(capsuleID: capsuleID, fileName: name)
        try FileManager.default.copyItem(at: sourceURL, to: destination)
        protect(destination)
        return name
    }

    /// Moves a (temporary) file into the capsule's folder, keeping its (lowercased) extension.
    /// Falls back to copy + delete when a move is not possible. Returns the new file name.
    static func moveFile(at sourceURL: URL, capsuleID: UUID) throws -> String {
        let name = makeFileName(fileExtension: sourceURL.pathExtension)
        let destination = url(capsuleID: capsuleID, fileName: name)
        do {
            try FileManager.default.moveItem(at: sourceURL, to: destination)
        } catch {
            try FileManager.default.copyItem(at: sourceURL, to: destination)
            try? FileManager.default.removeItem(at: sourceURL)
        }
        protect(destination)
        return name
    }

    // MARK: - Deleting

    /// Removes one media file. Silently ignores missing files and unsafe names.
    static func delete(fileName: String, capsuleID: UUID) {
        guard isSafeFileName(fileName) else { return }
        let target = capsuleLocation(capsuleID).appending(component: fileName, directoryHint: .notDirectory)
        removeIfPresent(target)
    }

    /// Removes a capsule's whole media folder.
    static func deleteAll(for capsuleID: UUID) {
        removeIfPresent(capsuleLocation(capsuleID))
        thumbnailCache.removeAllObjects()
    }

    // MARK: - Images

    /// JPEG data with the orientation baked in (always "up") and the longest side capped
    /// at 3000 px. Returns `nil` for an empty image.
    static func jpegData(from image: UIImage, compression: CGFloat = 0.85) -> Data? {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        guard pixelWidth > 0, pixelHeight > 0 else { return nil }

        let factor = min(1, maxJPEGPixelSize / max(pixelWidth, pixelHeight))
        let targetSize = CGSize(
            width: max(1, (pixelWidth * factor).rounded()),
            height: max(1, (pixelHeight * factor).rounded())
        )
        let bounds = CGRect(origin: .zero, size: targetSize)

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true

        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        let quality = min(max(compression, 0), 1)
        let data = renderer.jpegData(withCompressionQuality: quality) { context in
            UIColor.white.setFill()
            context.fill(bounds)
            image.draw(in: bounds)
        }
        return data.isEmpty ? nil : data
    }

    /// A downsampled preview image. Photos are decoded with ImageIO at the requested size;
    /// videos yield a frame from around 0.5 s; audio returns `nil`. Results are cached.
    static func thumbnail(for url: URL, kind: MediaKind, maxPixelSize: CGFloat = 600) async -> UIImage? {
        guard kind != .audio else { return nil }
        let edge = max(1, maxPixelSize.rounded())
        let key = NSString(string: "\(url.path(percentEncoded: false))|\(Int(edge))")
        if let cached = thumbnailCache.object(forKey: key) {
            return cached
        }
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return nil }

        let image: UIImage?
        switch kind {
        case .photo:
            image = await Task.detached(priority: .utility) {
                MediaStore.downsampledImage(at: url, maxPixelSize: edge)
            }.value
        case .video:
            image = await videoFrame(at: url, maxPixelSize: edge)
        case .audio:
            image = nil
        }

        if let image {
            let pixels = image.size.width * image.scale * image.size.height * image.scale
            thumbnailCache.setObject(image, forKey: key, cost: Int(pixels) * 4)
        }
        return image
    }

    // MARK: - Time-based media

    /// Length of an audio or video file in seconds; `0` when it cannot be read.
    static func duration(of url: URL) async -> Double {
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return 0 }
        do {
            let seconds = try await AVURLAsset(url: url).load(.duration).seconds
            return seconds.isFinite && seconds > 0 ? seconds : 0
        } catch {
            return 0
        }
    }

    // MARK: - Private

    private static let maxJPEGPixelSize: CGFloat = 3000

    private static let thumbnailCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 240
        cache.totalCostLimit = 96 * 1024 * 1024
        return cache
    }()

    /// `<Application Support>/Timeleaf` (not created by this accessor).
    private static var baseLocation: URL {
        URL.applicationSupportDirectory.appending(path: "Timeleaf", directoryHint: .isDirectory)
    }

    /// `<Application Support>/Timeleaf/Media` (not created by this accessor).
    private static var mediaRootLocation: URL {
        baseLocation.appending(path: "Media", directoryHint: .isDirectory)
    }

    /// `<Application Support>/Timeleaf/Media/<uuid>` (not created by this accessor).
    private static func capsuleLocation(_ capsuleID: UUID) -> URL {
        mediaRootLocation.appending(path: capsuleID.uuidString, directoryHint: .isDirectory)
    }

    /// Creates `directory` (and any missing parents) if needed. The shared base folder keeps
    /// the default protection class so that the SwiftData store living next to it is unaffected;
    /// our own media folders are created with complete protection.
    private static func prepareDirectory(_ directory: URL) {
        let fileManager = FileManager.default
        let base = baseLocation
        if !fileManager.fileExists(atPath: base.path(percentEncoded: false)) {
            try? fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        }
        guard !fileManager.fileExists(atPath: directory.path(percentEncoded: false)) else { return }
        try? fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
    }

    private static func protect(_ file: URL) {
        try? FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: file.path(percentEncoded: false)
        )
    }

    private static func removeIfPresent(_ location: URL) {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: location.path(percentEncoded: false)) else { return }
        try? fileManager.removeItem(at: location)
    }

    private static func makeFileName(fileExtension: String) -> String {
        let ext = fileExtension
            .trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
            .lowercased()
        let stem = UUID().uuidString
        return ext.isEmpty ? stem : "\(stem).\(ext)"
    }

    private static func isSafeFileName(_ name: String) -> Bool {
        !name.isEmpty && name != "." && name != ".." && !name.contains("/")
    }

    /// ImageIO downsampling: decodes straight to the target size, applying EXIF orientation.
    private static func downsampledImage(at url: URL, maxPixelSize: CGFloat) -> UIImage? {
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions as CFDictionary) else {
            return nil
        }
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(maxPixelSize),
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }

    /// A frame from around half a second in (or the very first frame for tiny clips).
    private static func videoFrame(at url: URL, maxPixelSize: CGFloat) async -> UIImage? {
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: maxPixelSize, height: maxPixelSize)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.25, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)

        var seconds = 0.5
        if let length = try? await asset.load(.duration), length.seconds.isFinite, length.seconds > 0 {
            seconds = min(0.5, length.seconds / 2)
        }

        let candidates: [CMTime] = [CMTime(seconds: seconds, preferredTimescale: 600), .zero]
        for time in candidates {
            if let frame = try? await generator.image(at: time) {
                return UIImage(cgImage: frame.image)
            }
        }
        return nil
    }
}
