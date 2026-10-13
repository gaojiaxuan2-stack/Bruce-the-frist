import Foundation
import SwiftData
import CryptoKit
import CommonCrypto
import UniformTypeIdentifiers

// A `.timeleaf` file is an envelope you can hand to someone dear.
//
//   "TLEAF1"                      6 bytes, magic
//   UInt32 (big-endian)           header length
//   header JSON                   what the envelope says on the outside (ISO-8601 dates)
//   AES.GCM combined sealed box   the letter itself; the header bytes are its authenticated
//                                 data, so changing the unlock date breaks the seal.
//
// Payload (inside the sealed box):
//   UInt32 (big-endian)           manifest length
//   manifest JSON                 title, message, mood, prompt, media descriptions
//   media bytes                   concatenated, in manifest order

// MARK: - Header

/// The outside of the envelope: everything a recipient may see before the letter opens.
struct PackageHeader: Codable {
    var version: Int
    var capsuleID: UUID
    var title: String
    var senderName: String
    var recipientName: String
    var unlockDate: Date
    var sealedAt: Date
    var themeRaw: String
    var requiresPassphrase: Bool
    var passphraseHint: String
    var salt: Data
    /// Present only when the letter is not protected by a secret word.
    var embeddedKey: Data?
}

// MARK: - Errors

enum CapsulePackageError: LocalizedError {
    case invalidFile
    case wrongPassphrase
    case stillSealed
    case corrupted
    case missingPackage

    var errorDescription: String? {
        switch self {
        case .invalidFile:
            return String(localized: "This doesn't seem to be a Timeleaf letter, or it was creased on its way to you. Ask the sender to share it once more.")
        case .wrongPassphrase:
            return String(localized: "That secret word doesn't open this letter. Try again — the hint might help.")
        case .stillSealed:
            return String(localized: "Not yet — this letter is still travelling through time. It will open on the day it was meant for.")
        case .corrupted:
            return String(localized: "Part of this letter was lost along the way, so it can't be opened safely. Ask the sender to share it once more.")
        case .missingPackage:
            return String(localized: "The sealed letter can no longer be found on this device. Ask the sender to share it with you again.")
        }
    }
}

// MARK: - Package

enum CapsulePackage {
    static let fileExtension: String = "timeleaf"
    static let contentType: UTType = UTType(exportedAs: "com.timeleaf.capsule")

    // Format constants
    private static let magic = Data("TLEAF1".utf8)
    private static let formatVersion = 1
    private static let maxHeaderLength = 1 << 20          // 1 MB – a header is a few hundred bytes
    private static let maxManifestLength = 32 << 20       // 32 MB – generous for very long letters
    private static let maxMediaCount = 2_000
    private static let keyByteCount = 32
    private static let pbkdf2Rounds: UInt32 = 210_000
    private static let minimumSealedBoxLength = 12 + 16   // nonce + tag
    private static var preambleLength: Int { magic.count + 4 }

    // MARK: Export

    /// Seals the capsule's contents into an encrypted `.timeleaf` file in a fresh temporary folder,
    /// named after the letter so the share sheet shows something lovely.
    @MainActor
    static func export(_ capsule: TimeCapsule, passphrase: String?, hint: String) throws -> URL {
        let secretWord = normalizedPassphrase(passphrase)
        let salt = makeRandomData(size: .bits128)

        let key: SymmetricKey
        let embeddedKey: Data?
        if let secretWord {
            key = try deriveKey(from: secretWord, salt: salt)
            embeddedKey = nil
        } else {
            let randomKey = SymmetricKey(size: .bits256)
            key = randomKey
            embeddedKey = randomKey.withUnsafeBytes { Data(Array($0)) }
        }

        let header = PackageHeader(
            version: formatVersion,
            capsuleID: capsule.id,
            title: capsule.title,
            senderName: exportSenderName(for: capsule),
            recipientName: capsule.recipientName,
            unlockDate: capsule.unlockDate,
            sealedAt: capsule.sealedAt ?? .now,
            themeRaw: capsule.themeRaw,
            requiresPassphrase: secretWord != nil,
            passphraseHint: secretWord != nil ? hint.trimmingCharacters(in: .whitespacesAndNewlines) : "",
            salt: salt,
            embeddedKey: embeddedKey
        )
        let headerData = try encodeJSON(header)
        guard headerData.count <= maxHeaderLength,
              let headerByteCount = UInt32(exactly: headerData.count) else {
            throw CapsulePackageError.corrupted
        }

        let payload = try makePayload(for: capsule)
        let sealedBox: AES.GCM.SealedBox
        do {
            sealedBox = try AES.GCM.seal(payload, using: key, nonce: AES.GCM.Nonce(), authenticating: headerData)
        } catch {
            throw CapsulePackageError.corrupted
        }
        guard let combined = sealedBox.combined else { throw CapsulePackageError.corrupted }

        var preamble = CapsulePackageByteWriter()
        preamble.appendBytes(magic)
        preamble.appendUInt32(headerByteCount)
        preamble.appendBytes(headerData)

        let fileURL = try makeExportURL(title: capsule.title)
        try writeFile(preamble: preamble.data, sealedBox: combined, to: fileURL)
        return fileURL
    }

    // MARK: Reading

    /// Reads and validates only the outside of the envelope (cheap, even for large files).
    static func readHeader(from url: URL) throws -> PackageHeader {
        let isScoped = url.startAccessingSecurityScopedResource()
        defer { if isScoped { url.stopAccessingSecurityScopedResource() } }

        let handle: FileHandle
        do {
            handle = try FileHandle(forReadingFrom: url)
        } catch {
            throw CapsulePackageError.invalidFile
        }
        defer { try? handle.close() }

        guard let preamble = try? handle.read(upToCount: preambleLength),
              preamble.count == preambleLength else {
            throw CapsulePackageError.invalidFile
        }
        let length = try headerLength(fromPreamble: preamble)
        guard let headerData = try? handle.read(upToCount: length),
              headerData.count == length else {
            throw CapsulePackageError.invalidFile
        }
        return try decodeHeader(headerData)
    }

    // MARK: Import

    /// Receives a `.timeleaf` file: keeps the still-encrypted package in the inbox and adds an
    /// incoming, sealed capsule to the vault. Returns the existing capsule if it was received before.
    @MainActor
    static func importPackage(from url: URL, into context: ModelContext) throws -> TimeCapsule {
        let isScoped = url.startAccessingSecurityScopedResource()
        defer { if isScoped { url.stopAccessingSecurityScopedResource() } }

        let header = try readHeader(from: url)
        let capsuleID = header.capsuleID
        let packageFileName = "\(capsuleID.uuidString).\(fileExtension)"
        let destination = MediaStore.inboxURL.appending(component: packageFileName, directoryHint: .notDirectory)

        if let existing = existingCapsule(id: capsuleID, in: context) {
            // Restore a lost package for a letter that still waits to be opened.
            if existing.isIncoming,
               existing.packageFileName != nil,
               !FileManager.default.fileExists(atPath: destination.path(percentEncoded: false)) {
                try copyPackage(from: url, to: destination)
                existing.packageFileName = packageFileName
                try? context.save()
            }
            discardSystemInboxCopy(at: url, wasSecurityScoped: isScoped)
            return existing
        }

        try copyPackage(from: url, to: destination)

        let capsule = TimeCapsule(
            id: capsuleID,
            title: header.title,
            message: "",
            createdAt: header.sealedAt,
            sealedAt: header.sealedAt,
            unlockDate: header.unlockDate,
            theme: ThemeID(rawValue: header.themeRaw) ?? .aurora,
            recipientKind: .someone,
            recipientName: header.recipientName,
            senderName: header.senderName,
            isIncoming: true,
            packageFileName: packageFileName,
            requiresPassphrase: header.requiresPassphrase,
            passphraseHint: header.passphraseHint
        )
        context.insert(capsule)
        do {
            try context.save()
        } catch {
            context.delete(capsule)
            try? FileManager.default.removeItem(at: destination)
            throw error
        }

        discardSystemInboxCopy(at: url, wasSecurityScoped: isScoped)
        scheduleArrivalReminder(for: capsule)
        return capsule
    }

    // MARK: Unpack

    /// Breaks the seal of an incoming capsule: decrypts the package, writes its media into the
    /// capsule's folder, fills in the letter and removes the package.
    @MainActor
    static func unpack(_ capsule: TimeCapsule, passphrase: String?, in context: ModelContext) throws {
        guard let packageFileName = capsule.packageFileName else {
            throw CapsulePackageError.missingPackage
        }
        let now = Date.now
        guard now >= capsule.unlockDate else { throw CapsulePackageError.stillSealed }

        let packageURL = MediaStore.inboxURL.appending(component: packageFileName, directoryHint: .notDirectory)
        let fileData: Data
        do {
            fileData = try Data(contentsOf: packageURL, options: .mappedIfSafe)
        } catch {
            throw CapsulePackageError.missingPackage
        }

        let parsed = try parsePackage(fileData)
        guard parsed.header.capsuleID == capsule.id else { throw CapsulePackageError.corrupted }
        // The header is authenticated, so its date is the one the sender truly chose.
        guard now >= parsed.header.unlockDate else { throw CapsulePackageError.stillSealed }

        let key = try decryptionKey(for: parsed.header, passphrase: passphrase)
        let payload = try decryptPayload(parsed, using: key)
        let contents = try readPayload(payload)
        let newMedia = try storeMedia(contents.blobs, capsuleID: capsule.id)

        let manifest = contents.manifest
        if !manifest.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            capsule.title = manifest.title
        }
        capsule.message = manifest.message
        capsule.mood = manifest.mood
        capsule.prompt = manifest.prompt
        for media in newMedia {
            context.insert(media)
            capsule.media.append(media)
        }
        capsule.packageFileName = nil

        // Only let go of the package once the letter is safely stored.
        do {
            try context.save()
            try? FileManager.default.removeItem(at: packageURL)
        } catch {
            // The context keeps the changes and autosaves later; the package stays as a backup.
        }
    }
}

// MARK: - Private: building the payload

extension CapsulePackage {
    @MainActor
    private static func makePayload(for capsule: TimeCapsule) throws -> Data {
        var entries: [CapsulePackageMediaEntry] = []
        var blobs: [Data] = []

        for item in capsule.sortedMedia {
            guard let url = MediaStore.url(for: item),
                  let bytes = try? Data(contentsOf: url, options: .mappedIfSafe) else { continue }
            entries.append(
                CapsulePackageMediaEntry(
                    kind: item.kind.rawValue,
                    fileExtension: mediaExtension(url.pathExtension, kind: item.kind),
                    duration: item.duration,
                    caption: item.caption,
                    sortIndex: item.sortIndex,
                    byteCount: bytes.count
                )
            )
            blobs.append(bytes)
        }

        let manifest = CapsulePackageManifest(
            title: capsule.title,
            message: capsule.message,
            mood: capsule.mood,
            prompt: capsule.prompt,
            media: entries
        )
        let manifestData = try encodeJSON(manifest)
        guard manifestData.count <= maxManifestLength,
              let manifestLength = UInt32(exactly: manifestData.count) else {
            throw CapsulePackageError.corrupted
        }

        var writer = CapsulePackageByteWriter()
        writer.reserve(4 + manifestData.count + blobs.reduce(0) { $0 + $1.count })
        writer.appendUInt32(manifestLength)
        writer.appendBytes(manifestData)
        for blob in blobs {
            writer.appendBytes(blob)
        }
        return writer.data
    }

    @MainActor
    private static func exportSenderName(for capsule: TimeCapsule) -> String {
        let name = capsule.senderName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        let stored = UserDefaults.standard.string(forKey: SettingsKey.userName) ?? ""
        return stored.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func makeExportURL(title: String) throws -> URL {
        let fileManager = FileManager.default
        let exportRoot = fileManager.temporaryDirectory
            .appending(component: "TimeleafExports", directoryHint: .isDirectory)
        removeStaleExports(in: exportRoot)

        let folder = exportRoot.appending(component: UUID().uuidString, directoryHint: .isDirectory)
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        let fileName = "\(exportBaseName(for: title)).\(fileExtension)"
        return folder.appending(component: fileName, directoryHint: .notDirectory)
    }

    /// Letters, digits, spaces and CJK are welcome; path-hostile characters are not.
    private static func exportBaseName(for title: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/:\\?%*|\"<>")
            .union(.controlCharacters)
            .union(.newlines)
        var cleaned = ""
        for scalar in title.unicodeScalars {
            if forbidden.contains(scalar) {
                cleaned.unicodeScalars.append(" ")
            } else {
                cleaned.unicodeScalars.append(scalar)
            }
        }
        var name = cleaned.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        while name.hasPrefix(".") {
            name.removeFirst()
        }
        name = String(name.prefix(64)).trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? String(localized: "Timeleaf Letter") : name
    }

    /// Old export folders are only needed while a share sheet is open.
    private static func removeStaleExports(in root: URL) {
        let fileManager = FileManager.default
        guard let folders = try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.creationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let cutoff = Date.now.addingTimeInterval(-3_600)
        for folder in folders {
            let created = (try? folder.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? .distantPast
            if created < cutoff {
                try? fileManager.removeItem(at: folder)
            }
        }
    }

    private static func writeFile(preamble: Data, sealedBox: Data, to url: URL) throws {
        do {
            try preamble.write(to: url, options: .atomic)
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            _ = try handle.seekToEnd()
            try handle.write(contentsOf: sealedBox)
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }
}

// MARK: - Private: reading and opening

extension CapsulePackage {
    /// Validates the magic and returns the header length the preamble announces.
    private static func headerLength(fromPreamble preamble: Data) throws -> Int {
        var reader = CapsulePackageByteReader(preamble, failure: .invalidFile)
        let signature = try reader.readSlice(magic.count)
        guard signature.elementsEqual(magic) else { throw CapsulePackageError.invalidFile }
        let length = try Int(reader.readUInt32())
        guard length > 0, length <= maxHeaderLength else { throw CapsulePackageError.invalidFile }
        return length
    }

    private static func decodeHeader(_ data: Data) throws -> PackageHeader {
        let header = try decodeJSON(PackageHeader.self, from: data, failure: .invalidFile)
        guard header.version == formatVersion else { throw CapsulePackageError.invalidFile }
        if header.requiresPassphrase {
            guard !header.salt.isEmpty else { throw CapsulePackageError.invalidFile }
        } else {
            guard header.embeddedKey?.count == keyByteCount else { throw CapsulePackageError.invalidFile }
        }
        return header
    }

    private static func parsePackage(_ fileData: Data) throws -> CapsulePackageParsed {
        var reader = CapsulePackageByteReader(fileData, failure: .invalidFile)
        let preamble = try reader.readCopy(preambleLength)
        let length = try headerLength(fromPreamble: preamble)
        let headerData = try reader.readCopy(length)
        let header = try decodeHeader(headerData)
        let sealedBox = reader.readRemaining()
        guard sealedBox.count >= minimumSealedBoxLength else { throw CapsulePackageError.corrupted }
        return CapsulePackageParsed(header: header, headerData: headerData, sealedBox: sealedBox)
    }

    private static func decryptionKey(for header: PackageHeader, passphrase: String?) throws -> SymmetricKey {
        if header.requiresPassphrase {
            guard let secretWord = normalizedPassphrase(passphrase) else {
                throw CapsulePackageError.wrongPassphrase
            }
            return try deriveKey(from: secretWord, salt: header.salt)
        }
        guard let embeddedKey = header.embeddedKey, embeddedKey.count == keyByteCount else {
            throw CapsulePackageError.corrupted
        }
        return SymmetricKey(data: embeddedKey)
    }

    private static func decryptPayload(_ parsed: CapsulePackageParsed, using key: SymmetricKey) throws -> Data {
        do {
            let box = try AES.GCM.SealedBox(combined: parsed.sealedBox)
            return try AES.GCM.open(box, using: key, authenticating: parsed.headerData)
        } catch CryptoKitError.authenticationFailure {
            // With a secret word we cannot tell a typo from tampering; assume the kinder one.
            throw parsed.header.requiresPassphrase
                ? CapsulePackageError.wrongPassphrase
                : CapsulePackageError.corrupted
        } catch {
            throw CapsulePackageError.corrupted
        }
    }

    private static func readPayload(_ payload: Data) throws -> CapsulePackageContents {
        var reader = CapsulePackageByteReader(payload, failure: .corrupted)
        let manifestLength = try Int(reader.readUInt32())
        guard manifestLength <= maxManifestLength else { throw CapsulePackageError.corrupted }
        let manifestData = try reader.readCopy(manifestLength)
        let manifest = try decodeJSON(CapsulePackageManifest.self, from: manifestData, failure: .corrupted)
        guard manifest.media.count <= maxMediaCount else { throw CapsulePackageError.corrupted }

        // Check every bound before anything touches the disk.
        var blobs: [CapsulePackageBlob] = []
        blobs.reserveCapacity(manifest.media.count)
        for entry in manifest.media {
            let bytes = try reader.readSlice(entry.byteCount)
            blobs.append(CapsulePackageBlob(entry: entry, bytes: bytes))
        }
        return CapsulePackageContents(manifest: manifest, blobs: blobs)
    }

    @MainActor
    private static func storeMedia(_ blobs: [CapsulePackageBlob], capsuleID: UUID) throws -> [CapsuleMedia] {
        var created: [CapsuleMedia] = []
        var writtenFiles: [String] = []
        do {
            for blob in blobs {
                guard let kind = MediaKind(rawValue: blob.entry.kind) else { continue }
                let fileName = try MediaStore.save(
                    blob.bytes,
                    capsuleID: capsuleID,
                    fileExtension: mediaExtension(blob.entry.fileExtension, kind: kind)
                )
                writtenFiles.append(fileName)
                let duration = blob.entry.duration.isFinite ? max(0, blob.entry.duration) : 0
                created.append(
                    CapsuleMedia(
                        kind: kind,
                        fileName: fileName,
                        sortIndex: blob.entry.sortIndex,
                        duration: duration,
                        caption: blob.entry.caption
                    )
                )
            }
        } catch {
            for fileName in writtenFiles {
                MediaStore.delete(fileName: fileName, capsuleID: capsuleID)
            }
            throw error
        }
        return created
    }
}

// MARK: - Private: import helpers

extension CapsulePackage {
    @MainActor
    private static func existingCapsule(id capsuleID: UUID, in context: ModelContext) -> TimeCapsule? {
        var descriptor = FetchDescriptor<TimeCapsule>(
            predicate: #Predicate<TimeCapsule> { $0.id == capsuleID }
        )
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }

    private static func copyPackage(from source: URL, to destination: URL) throws {
        if source.standardizedFileURL == destination.standardizedFileURL { return }
        let fileManager = FileManager.default
        do {
            if fileManager.fileExists(atPath: destination.path(percentEncoded: false)) {
                try fileManager.removeItem(at: destination)
            }
            try fileManager.copyItem(at: source, to: destination)
        } catch {
            throw CapsulePackageError.invalidFile
        }
    }

    /// "Open in Timeleaf" hands the app a private copy inside its own `Documents/Inbox`
    /// (or `tmp/<bundle>-Inbox`). Once the package is safely stored, that copy is clutter.
    /// Files picked from elsewhere (security-scoped) are never touched.
    private static func discardSystemInboxCopy(at url: URL, wasSecurityScoped: Bool) {
        guard !wasSecurityScoped, url.isFileURL else { return }
        let parent = url.deletingLastPathComponent()
        let parentName = parent.lastPathComponent
        let grandparentName = parent.deletingLastPathComponent().lastPathComponent
        let isSystemInbox = (parentName == "Inbox" && grandparentName == "Documents")
            || parentName.hasSuffix("-Inbox")
        guard isSystemInbox else { return }
        try? FileManager.default.removeItem(at: url)
    }

    /// A received letter should knock on the door the moment it may be opened.
    @MainActor
    private static func scheduleArrivalReminder(for capsule: TimeCapsule) {
        let capsuleID = capsule.id
        let title = capsule.title
        let unlockDate = capsule.unlockDate
        let sender = capsule.displaySender
        guard unlockDate > .now else { return }
        Task {
            guard await NotificationScheduler.requestAuthorization() else { return }
            NotificationScheduler.schedule(
                capsuleID: capsuleID,
                title: title,
                unlockDate: unlockDate,
                senderName: sender,
                isIncoming: true,
                toSelf: false
            )
        }
    }
}

// MARK: - Private: crypto & coding

extension CapsulePackage {
    /// Trimmed and lowercased, so "Moonlight " and "moonlight" open the same letter.
    private static func normalizedPassphrase(_ passphrase: String?) -> String? {
        guard let passphrase else { return nil }
        let normalized = passphrase
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .precomposedStringWithCanonicalMapping
            .lowercased()
        return normalized.isEmpty ? nil : normalized
    }

    /// PBKDF2-HMAC-SHA256, 210 000 rounds, 32-byte key.
    private static func deriveKey(from secretWord: String, salt: Data) throws -> SymmetricKey {
        guard !salt.isEmpty else { throw CapsulePackageError.corrupted }
        let password: [CChar] = secretWord.utf8.map { CChar(bitPattern: $0) }
        let saltBytes = [UInt8](salt)
        var derived = [UInt8](repeating: 0, count: keyByteCount)

        let status = derived.withUnsafeMutableBufferPointer { derivedBuffer in
            password.withUnsafeBufferPointer { passwordBuffer in
                saltBytes.withUnsafeBufferPointer { saltBuffer in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordBuffer.baseAddress,
                        passwordBuffer.count,
                        saltBuffer.baseAddress,
                        saltBuffer.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        pbkdf2Rounds,
                        derivedBuffer.baseAddress,
                        derivedBuffer.count
                    )
                }
            }
        }
        guard status == Int32(kCCSuccess) else { throw CapsulePackageError.corrupted }
        return SymmetricKey(data: derived)
    }

    private static func makeRandomData(size: SymmetricKeySize) -> Data {
        SymmetricKey(size: size).withUnsafeBytes { Data(Array($0)) }
    }

    private static func mediaExtension(_ raw: String, kind: MediaKind) -> String {
        let candidate = raw.lowercased()
        let isSafe = !candidate.isEmpty
            && candidate.count <= 8
            && candidate.unicodeScalars.allSatisfy { $0.isASCII && CharacterSet.alphanumerics.contains($0) }
        if isSafe { return candidate }
        switch kind {
        case .photo: return "jpg"
        case .video: return "mov"
        case .audio: return "m4a"
        }
    }

    private static func encodeJSON<Value: Encodable>(_ value: Value) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        do {
            return try encoder.encode(value)
        } catch {
            throw CapsulePackageError.corrupted
        }
    }

    private static func decodeJSON<Value: Decodable>(
        _ type: Value.Type,
        from data: Data,
        failure: CapsulePackageError
    ) throws -> Value {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw failure
        }
    }
}

// MARK: - Private types

private struct CapsulePackageManifest: Codable {
    var title: String
    var message: String
    var mood: String
    var prompt: String
    var media: [CapsulePackageMediaEntry]
}

private struct CapsulePackageMediaEntry: Codable {
    var kind: String
    var fileExtension: String
    var duration: Double
    var caption: String
    var sortIndex: Int
    var byteCount: Int
}

private struct CapsulePackageParsed {
    let header: PackageHeader
    /// The exact header bytes from the file – the AES-GCM authenticated data.
    let headerData: Data
    let sealedBox: Data
}

private struct CapsulePackageBlob {
    let entry: CapsulePackageMediaEntry
    let bytes: Data
}

private struct CapsulePackageContents {
    let manifest: CapsulePackageManifest
    let blobs: [CapsulePackageBlob]
}

/// Bounds-checked sequential reader. Every overrun throws `failure`.
private struct CapsulePackageByteReader {
    private let data: Data
    private var position: Data.Index
    private let failure: CapsulePackageError

    init(_ data: Data, failure: CapsulePackageError) {
        self.data = data
        self.position = data.startIndex
        self.failure = failure
    }

    var remainingCount: Int { data.endIndex - position }

    mutating func readUInt32() throws -> UInt32 {
        let bytes = try readSlice(4)
        var value: UInt32 = 0
        for byte in bytes {
            value = (value << 8) | UInt32(byte)
        }
        return value
    }

    /// Shares storage with the source – cheap, used for large media.
    mutating func readSlice(_ count: Int) throws -> Data {
        guard count >= 0, count <= remainingCount else { throw failure }
        let end = position + count
        let slice = data[position..<end]
        position = end
        return slice
    }

    /// A compact zero-based copy – used for small structured pieces such as JSON.
    mutating func readCopy(_ count: Int) throws -> Data {
        guard count >= 0, count <= remainingCount else { throw failure }
        let end = position + count
        let copy = data.subdata(in: position..<end)
        position = end
        return copy
    }

    mutating func readRemaining() -> Data {
        let slice = data[position..<data.endIndex]
        position = data.endIndex
        return slice
    }
}

private struct CapsulePackageByteWriter {
    private(set) var data = Data()

    mutating func reserve(_ capacity: Int) {
        data.reserveCapacity(capacity)
    }

    /// Big-endian.
    mutating func appendUInt32(_ value: UInt32) {
        data.append(UInt8(truncatingIfNeeded: value >> 24))
        data.append(UInt8(truncatingIfNeeded: value >> 16))
        data.append(UInt8(truncatingIfNeeded: value >> 8))
        data.append(UInt8(truncatingIfNeeded: value))
    }

    mutating func appendBytes(_ bytes: Data) {
        data.append(bytes)
    }
}
