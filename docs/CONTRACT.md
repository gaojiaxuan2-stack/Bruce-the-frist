# Timeleaf · 时笺 — Engineering contract

> 时笺 (shí jiān) sounds exactly like 时间 "time"; 笺 is fine letter paper.
> Timeleaf lets you seal words, photos, videos and voice notes inside a letter that
> cannot be opened until a date you choose — by your future self, or by someone dear.

This file is the single source of truth for every cross-file API. **If a type or
function is not listed here (or in an existing file under `Timeleaf/Core`,
`Timeleaf/App`, `Timeleaf/Themes/ThemeViews.swift`), it must be `private` /
`fileprivate` to the file that defines it.**

## Platform & language rules

- iOS **18.0+**, SwiftUI, SwiftData, Observation (`@Observable`), Swift **5** language mode
  (no strict-concurrency errors, but write concurrency-correct code anyway).
- Allowed frameworks: SwiftUI, SwiftData, Foundation, UIKit (only where needed),
  AVFoundation, AVKit, PhotosUI, CryptoKit, CommonCrypto, UniformTypeIdentifiers,
  UserNotifications, LocalAuthentication, ImageIO, CoreImage. **No third-party packages.**
- No iOS 26-only APIs (no `glassEffect`, etc.). iOS 18 APIs (MeshGradient, `@Entry`,
  `onScrollGeometryChange`, `.containerRelativeFrame`, `phaseAnimator`, `keyframeAnimator`,
  `TimelineView`, `Canvas`, `.visualEffect`, `.scrollTransition`, `PhotosPicker`) are fine.
- Text: use the theme's `display` / `body` / `label` fonts. They follow Dynamic Type (system-font
  paths through `Theme.typeScale`, custom fonts through `relativeTo:`) and `AppShell` caps the whole
  app at `...DynamicTypeSize.accessibility2`; do not add per-view font scaling.
- Fonts: only fonts built into iOS (e.g. "Baskerville", "Georgia", "Didot", "Bodoni 72",
  "Cochin", "Snell Roundhand", "Savoye LET", "Hoefler Text", "Iowan Old Style",
  "Palatino", "Avenir Next", "Futura", "Gill Sans", "Optima", "Helvetica Neue", "Menlo",
  "Charter"). Chinese text falls back to PingFang automatically.
- Never name a type after a SwiftUI/Foundation type: no `Capsule`, `TimelineView`,
  `Label`, `Section`, `Material`, `Theme*` (except the contract's), `Group`, `Shape`,
  `Gradient`, `Image`, `Text`, `Color`, `Animation`, `Envelope*` (except the contract's) …
- All non-contract helper types/extensions are `private` (file-scope `private` is fine)
  and **prefixed with the file's feature** (e.g. `private struct AuroraRibbon`). Do not add
  non-private extensions on shared types (`Color`, `View`, `Date`, `String`, `Theme`, …)
  except where this contract says so — duplicate members across files break the build.
- Keep SwiftUI `body` expressions small: split into computed properties / private
  subviews to avoid "unable to type-check this expression in reasonable time".
- Every `ForEach` uses `Identifiable` data or an explicit `id:`.
- Use `onChange(of:) { oldValue, newValue in }` (two-parameter) or `{ }` (zero-parameter) forms.
- Respect `@Environment(\.accessibilityReduceMotion)` in looping/ambient animations.
- No force unwraps / `try!` / `fatalError` in feature code.
- Localization: user-facing literals go straight into `Text("…")`, `Button("…")`,
  `.navigationTitle("…")` (they become `LocalizedStringKey`s). When you need a `String`,
  use `String(localized: "…")`. Use interpolation inside one literal
  (`Text("Opens in \(phrase)")`), never concatenate sentence fragments.
- Syntax check every file you write (SwiftUI can't type-check on Linux, but parse can):
  `docker run --rm -v /home/user/Bruce-the-frist:/src -w /src swift:6.1-noble swiftc -parse <paths…>`

## Folder ownership

```
Timeleaf/App/            TimeleafApp.swift, AppShell.swift                 (core — exists)
Timeleaf/Core/           Models.swift, Theme.swift, Support.swift, PreviewData.swift (core — exists)
Timeleaf/Themes/         ThemeViews.swift (core — exists) + one file per style
Timeleaf/Services/       MediaStore, VoiceRecorder, MediaPickers, Haptics,
                         CapsulePackage, NotificationScheduler, AppLock, CapsuleActions
Timeleaf/Components/     shared themed UI pieces
Timeleaf/Features/Vault/       RootView, VaultView, HorizonView
Timeleaf/Features/Compose/     ComposeFlowView (+ private steps), ShareCapsuleSheet
Timeleaf/Features/Capsule/     CapsuleDestinationView, sealed / ceremony / reader screens
Timeleaf/Features/Settings/    StylesView, LockScreenView
Timeleaf/Features/Onboarding/  OnboardingView
```

## Core (already written — read these files, do not modify)

- `Core/Models.swift`: `TimeCapsule` (@Model), `CapsuleMedia` (@Model), `RecipientKind`,
  `MediaKind` (`symbolName`), `CapsuleState` (`draft/sealed/ready/opened`), `Monogram.make(from:)`.
  `TimeCapsule` helpers: `theme: ThemeID`, `recipientKind`, `state(at:)`, `progress(at:)`,
  `sortedMedia`, `displayRecipient`, `displaySender`, `monogram`.
- `Core/Theme.swift`: `ThemeID` (6 cases, `.theme`), `Theme` tokens + `display(_:weight:)`,
  `body(_:weight:)`, `label(_:weight:)`, `linearGradient`; `@Environment(\.theme)`;
  `View.theme(_:)` (local subtree) and `View.screenTheme(_:)` (root of a screen/cover).
  Fonts scale with Dynamic Type: `display` like `.title`, `body` like `.body`, `label` like `.footnote`.
  `Theme.typeScale: (display: CGFloat, body: CGFloat, label: CGFloat)` (default `(1, 1, 1)`) is filled in
  by `theme(_:)` / `screenTheme(_:)` from the environment's Dynamic Type size — never set it yourself.
- `Core/Support.swift`: `SettingsKey` (`theme`, `userName`, `appLock`, `haptics`, `onboarded`),
  `AppTab` (`vault/horizon/styles`), `AppRouter` (@Observable: `selectedTab`,
  `presentedCapsuleID: UUID?`, `isComposing`, `alertMessage: String?`),
  `Color(hex:opacity:)`, `Date.adding(_:_:)`, `View.routerAlert(_ router: AppRouter)` (attach at the root of every full-screen cover).
- `Core/PreviewData.swift`: `PreviewData.container` (in-memory, sample capsules).
- `App/AppShell.swift`: applies `screenTheme` and caps Dynamic Type at `...DynamicTypeSize.accessibility2`,
  gates `OnboardingView`, overlays `LockScreenView` when `AppLock.isLocked`, imports `.timeleaf` URLs via
  `onOpenURL` (in a `Task`, since `importPackage` is async). Each AppShell binds a `LockWindowController`
  (`App/LockWindowController.swift`) to its own `UIWindowScene`; that window sits above every sheet and cover and
  shows `.veil` (style backdrop + seal; never key, never touches the keyboard) while the scene is `.inactive` with
  the lock setting on, `.locked` (`LockScreenView`, key, ends editing in its own scene only) while `AppLock.isLocked`,
  and `.hidden` otherwise. A scene entering `.background` engages the app-wide lock (`lockIfNeeded()`) only when no
  other connected scene is still in the foreground (iPad Split View / Stage Manager); until then it only veils
  itself (lock setting on). A window that is `.active` when the lock engages asks to unlock at once.
  Deliberate trade-off: the veil leaves a keyboard that was up (QuickType bar included) above it, because ending
  editing would also take the focus from under system permission prompts.
- `Themes/ThemeViews.swift`: dispatchers `ThemeBackground()`, `SealView(monogram:)`,
  `CeremonyBurst()`, `StationeryView()` — they switch on `theme.id` to the per-style views below.

The app root injects: `.environment(AppRouter)`, `.environment(AppLock)`, `.modelContainer`.
Read them with `@Environment(AppRouter.self) private var router`.

---

## Themes — `Themes/<Name>Theme.swift` (Name ∈ Aurora, Parchment, InkWash, Celestial, Blossom, Monolith)

Each file defines exactly these non-private symbols:

```swift
extension Theme { static let aurora = Theme(id: .aurora, name: "Aurora", nativeName: "极光", …) }
struct AuroraBackground: View      // init() — full-bleed ambient animated backdrop (drawn over theme.background)
struct AuroraSeal: View            // init(monogram: String) — fills the proposed square
struct AuroraBurst: View           // init() — one-shot unseal celebration played on appear (~1.5–2.5 s), then settles
struct AuroraStationery: View      // init() — letter paper surface, fills its frame
```
(static names: `.aurora .parchment .inkwash .celestial .blossom .monolith`;
type prefixes: `Aurora Parchment InkWash Celestial Blossom Monolith`.)

Creative direction (make each one gorgeous, distinct, and calm — elegance over noise):

| Style | Mood | Palette | Type | Background | Seal | Burst | Stationery |
|---|---|---|---|---|---|---|---|
| **Aurora 极光** (dark) | Northern lights over a still night | midnight `#070B1A`, teal, mint `#7CF5D3`, violet `#9B7BFF` | Avenir Next / system | slowly breathing `MeshGradient` ribbons + faint stars | luminous glass orb, iridescent rim, monogram | sweeping light ribbons / rays | frosted glass sheet with faint aurora edge |
| **Parchment 信笺** (light) | A letter found in grandmother's drawer | cream `#F3E9D7`, sepia ink `#3B2A1A`, oxblood wax `#8E1B1B`, gold `#B08D57` | Didot / Snell Roundhand display, Baskerville body | paper grain (deterministic `Canvas` noise), vignette, faint postmark rings | irregular wax blob with embossed monogram & highlight | wax crumbs + golden dust motes | ruled paper, margin rule, deckled edge shadow |
| **Ink Wash 水墨** (light) | Mist over Huangshan, brush & rice paper | rice paper `#F5F1E8`, ink `#1C1C1C`, grey washes, vermilion `#C23B22` | serif design | layered misty mountain silhouettes (Paths + blur), drifting mist, a distant bird | square vermilion chop 印章 with white (阴文) monogram & rough edge | an ink drop blooming outward | **八行笺** – rice paper with eight vermilion vertical rules |
| **Celestial 星河** (dark) | The Milky Way, a gold astrolabe | night `#05060F`, deep navy, gold `#D4AF6A`, starlight white | Cochin / Didot | twinkling starfield (`Canvas`+`TimelineView`), Milky Way haze, rare shooting star, slow constellation lines | gold eight-point star medallion / astrolabe ring | starburst + shooting stars | navy sheet with faint gold star-chart circles |
| **Blossom 花信** (light) | A spring letter with pressed sakura | blush `#FCEFF1`, peach, rose `#E58FA5`, sage | rounded design | gently falling sakura petals with sway | five-petal pressed-flower seal | swirling petal shower | watercolor washes in corners |
| **Monolith 极简** (dark) | Swiss modernism, the precision of a clock | near-black `#0A0A0A`, white ink, one signal orange `#FF5A1F` | Helvetica Neue / system, monospaced digits | fine grid, one slowly rotating thin dial ring | concentric clock-face rings with monogram | expanding concentric rings | plain sheet with hairline grid |

Backgrounds must be cheap: ≤ ~120 particles, `Canvas` + `TimelineView(.animation(minimumInterval: 1/30))`,
deterministic pseudo-random (seeded by index, never `Double.random` per frame), and
static (or near-static) when Reduce Motion is on.

## Services

### `Services/MediaStore.swift`
```swift
enum MediaStore {
    static var rootURL: URL                     // <Application Support>/Timeleaf/Media, created on demand
    static var inboxURL: URL                    // <Application Support>/Timeleaf/Inbox, created on demand
    static func directory(for capsuleID: UUID) -> URL            // created on demand
    static func url(capsuleID: UUID, fileName: String) -> URL
    static func url(for media: CapsuleMedia) -> URL?             // nil if media.capsule == nil
    static func save(_ data: Data, capsuleID: UUID, fileExtension: String) throws -> String  // returns new file name "<uuid>.<ext>"
    static func copyFile(at sourceURL: URL, capsuleID: UUID) throws -> String  // keeps (lowercased) extension
    static func moveFile(at sourceURL: URL, capsuleID: UUID) throws -> String
    static func delete(fileName: String, capsuleID: UUID)
    static func deleteAll(for capsuleID: UUID)
    static func jpegData(from image: UIImage, compression: CGFloat = 0.85) -> Data?  // fixes orientation, max 3000 px
    static func thumbnail(for url: URL, kind: MediaKind, maxPixelSize: CGFloat = 600) async -> UIImage? // photo: ImageIO downsample; video: frame at ~0.5 s; audio: nil. Cached (NSCache).
    static func duration(of url: URL) async -> Double            // seconds, 0 on failure
}
```

### `Services/VoiceRecorder.swift`
```swift
@MainActor @Observable final class VoiceRecorder {
    private(set) var isRecording: Bool
    private(set) var elapsed: TimeInterval
    private(set) var levels: [CGFloat]          // most recent ~48 normalized levels 0...1 (for a waveform)
    private(set) var permissionDenied: Bool
    let maxDuration: TimeInterval               // 300
    init()
    func start() async                          // asks mic permission, records AAC .m4a into a temp file
    func stop() -> URL?                         // stops; returns the recorded temp file
    func cancel()                               // stops and deletes the temp file
}
@MainActor @Observable final class AudioPlayback {
    static func stopAll()                       // pauses whichever note is playing (call before a video plays)
    private(set) var isPlaying: Bool
    private(set) var progress: Double           // 0...1
    private(set) var duration: TimeInterval
    init()
    func load(_ url: URL)
    func toggle()
    func stop()
}
```
Only one `AudioPlayback` is audible at a time: starting one pauses the one that was playing.
`VoiceRecorder.start()` calls `AudioPlayback.stopAll()` before it takes the microphone.

### `Services/MediaPickers.swift`
```swift
struct CameraPicker: UIViewControllerRepresentable {   // photo or video from the camera
    enum Output { case photo(UIImage), video(URL) }      // video URL is a temp copy owned by the caller
    static var isAvailable: Bool
    var onComplete: (Output?) -> Void                    // nil when cancelled
}
struct PickedMovie: Transferable { let url: URL }        // for PhotosPicker videos; copies into a temp file
```
Present the camera with `.fullScreenCover { CameraPicker { … }.ignoresSafeArea() }`.

### `Services/Haptics.swift`
```swift
enum Haptics {            // all no-ops when UserDefaults bool SettingsKey.haptics == false (default true)
    static func tap()
    static func soft()
    static func rigid()
    static func success()
    static func warning()
    static func heartbeat()                    // two soft pulses
    static func intensity(_ value: Double)     // rigid impact with intensity 0...1
}
```

### `Services/CapsulePackage.swift`
A shareable, encrypted `.timeleaf` file (UTType `com.timeleaf.capsule`, declared in `Support/Info.plist`).
```swift
struct PackageHeader: Codable {
    var version: Int; var capsuleID: UUID; var title: String
    var senderName: String; var recipientName: String
    var unlockDate: Date; var sealedAt: Date; var themeRaw: String
    var requiresPassphrase: Bool; var passphraseHint: String
    var salt: Data; var embeddedKey: Data?     // embeddedKey present only when no passphrase
}
enum CapsulePackageError: LocalizedError { case invalidFile, wrongPassphrase, stillSealed, corrupted, missingPackage, tooLarge }
enum CapsulePackage {
    static let fileExtension: String           // "timeleaf"
    static let contentType: UTType             // UTType(exportedAs: "com.timeleaf.capsule")
    static let maxShareBytes: Int              // 300 MB – the most media one shared letter may carry
    @MainActor static func export(_ capsule: TimeCapsule, passphrase: String?, hint: String) async throws -> URL  // temp file "<Title>.timeleaf"; .tooLarge over maxShareBytes; CancellationError when cancelled
    @MainActor static func canShare(_ capsule: TimeCapsule) -> Bool   // media total ≤ maxShareBytes, measured as export does (file metadata only)
    static func readHeader(from url: URL) throws -> PackageHeader
    @MainActor static func importPackage(from url: URL, into context: ModelContext) async throws -> TimeCapsule
    @MainActor static func unpack(_ capsule: TimeCapsule, passphrase: String?, in context: ModelContext) async throws
    static func removeTemporaryFiles()         // leftover export copies + half-swapped inbox files; launch only
}
```
Do not `switch` exhaustively over `CapsulePackageError` (show `error.localizedDescription`; match single
cases with `catch CapsulePackageError.stillSealed`).
File format: `"TLEAF1"` (6 bytes) · UInt32 BE header length · header JSON (ISO-8601 dates) ·
`AES.GCM` combined sealed box of the payload, **with the header bytes as authenticated data**
(tampering with the unlock date breaks decryption). Payload = UInt32 BE manifest length ·
manifest JSON (`title, message, mood, prompt, media: [{kind, fileExtension, duration, caption, sortIndex, byteCount}]`) ·
concatenated media bytes. Key = PBKDF2-HMAC-SHA256(normalized passphrase = trimmed+lowercased,
salt 16 B, 210 000 rounds, 32 B) via CommonCrypto, or a random 256-bit key stored as `embeddedKey`.
`importPackage` handles security-scoped URLs, copies the file into `MediaStore.inboxURL`,
inserts an incoming `TimeCapsule` (`isIncoming = true`, `sealedAt`/`unlockDate`/theme/names from
the header, `recipientKind = .someone`, empty message, `packageFileName` set) and saves; if a capsule with the
same id already exists it returns that one. If that one is still waiting to be unpacked, a new file without a
secret word is first opened in memory (header as authenticated data, plaintext discarded) and, only if it opens,
atomically replaces the stored package and refreshes the header fields (title, names, dates, theme, secret-word
flag and hint) and arrival reminder. A secret-word file cannot be opened before its day: it replaces the stored
package when its header salt differs from the stored one's (a new share, perhaps with a new word and hint) or the
stored package is missing or unreadable; the same share received twice (same salt) keeps the stored file. A damaged
new file is ignored while the stored package is readable (otherwise its error is thrown). Opening a copy in memory
only detects accidental damage — it is no protection against tampering, since headers (embedded key included) are
unauthenticated until `unpack`. Callers wrap `importPackage` in a `Task { do { try await … } catch { … } }`.
`export`, `importPackage` and `unpack` read and change the model on the main actor and do key derivation,
sealing/decryption, validation and file copying/reading/writing in a detached task (callers use `try await`).
`export` honours cooperative cancellation: cancelling the calling task stops the detached work between stages,
deletes its temp output and throws `CancellationError` (callers cancel when their UI goes away and ignore that
error). `export` sums the media file sizes before reading any media and throws
`.tooLarge` above `maxShareBytes`; `readHeader`/`importPackage`/`unpack` reject files larger than
`maxShareBytes` + 16 MB with `.invalidFile` before reading them. `unpack` throws `.stillSealed` before `unlockDate`,
`.wrongPassphrase` on authentication failure; on success fills message/mood/prompt, writes media via
`MediaStore`, creates `CapsuleMedia`, deletes the package file, clears `packageFileName`, saves. An incoming capsule
that was already unpacked (e.g. in another window: no package, opened or holding its letter) returns successfully;
`.missingPackage` means there is no package to open (file gone, or the letter deleted meanwhile).

### `Services/NotificationScheduler.swift`
```swift
enum NotificationScheduler {
    static func requestAuthorization() async -> Bool
    static func schedule(capsuleID: UUID, title: String, unlockDate: Date, senderName: String, isIncoming: Bool, toSelf: Bool,
                         recipientName: String = "", sealedAt: Date? = nil)   // sealedAt: journey start (default now)
    static func cancel(capsuleID: UUID)
}
final class NotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared: NotificationCenterDelegate
    var onOpenCapsule: ((UUID) -> Void)?       // setting it delivers any id received before it was set
}
```
Notification `userInfo["capsuleID"] = uuidString`. Foreground notifications show as banners.
Triggers carry the current calendar and time zone, so they fire at the absolute unlock instant.

### `Services/AppLock.swift`
```swift
@MainActor @Observable final class AppLock {
    private(set) var isLocked: Bool            // starts true when the appLock setting is on
    private(set) var isAuthenticating: Bool
    init()
    func lockIfNeeded()                        // locks if the setting is on
    func unlock() async                        // LAContext .deviceOwnerAuthentication; unlocks immediately if setting is off
    static var biometryLabel: String           // "Face ID" / "Touch ID" / "Optic ID" / "Passcode"
    static var biometrySymbol: String          // "faceid" / "touchid" / "opticid" / "lock"
}
```

### `Services/CapsuleActions.swift`
```swift
@MainActor enum CapsuleActions {
    static func seal(_ capsule: TimeCapsule, in context: ModelContext) async  // sealedAt = now (if nil), insert if needed, save, request permission, schedule notification
    static func markOpened(_ capsule: TimeCapsule, in context: ModelContext)  // openedAt = now, save, cancel notification
    static func delete(_ capsule: TimeCapsule, in context: ModelContext)      // cancel notification, delete media + inbox package, delete model, save
    static func rescheduleNotifications(in context: ModelContext) async     // never prompts; if allowed, re-schedules the soonest 30 sealed, unopened, future letters
    static func removeOrphanedMedia(in context: ModelContext)               // once per launch: media folders / inbox packages of no capsule, export leftovers
}
```
`markOpened`/`delete`/`seal` ignore a model that is already deleted. `AppShell` calls `rescheduleNotifications`
on every `.active` and `removeOrphanedMedia` from a root `.task`; `StylesView` calls `rescheduleNotifications`
when notifications become allowed.

## Components (`Components/*.swift`)

```swift
extension View {
    func themedCard(padding: CGFloat = 20) -> some View   // surface fill (+material if theme.usesMaterial), hairline stroke, theme corner radius, soft shadow
    func themedGlow(_ active: Bool) -> some View          // gentle breathing glow in theme.glow when active
    func themedField() -> some View                       // styling for TextField / TextEditor containers
}
struct ThemedButtonStyle: ButtonStyle { enum Kind { case primary, secondary, ghost }; var kind: Kind }
extension ButtonStyle where Self == ThemedButtonStyle {
    static var themedPrimary: ThemedButtonStyle { get }    // full-width, accent fill, accentInk text
    static var themedSecondary: ThemedButtonStyle { get }  // full-width, surface fill + stroke
    static var themedGhost: ThemedButtonStyle { get }      // text only, accent
}
struct SectionHeader: View { init(_ title: LocalizedStringKey, subtitle: LocalizedStringKey? = nil) }
struct EmptyStateView: View { init(symbol: String, title: LocalizedStringKey, message: LocalizedStringKey) }
struct StateBadge: View { init(state: CapsuleState) }     // "Sealed" / "Ready" / "Opened" pill
struct ProgressRing: View { init(progress: Double, lineWidth: CGFloat = 4) }
struct CountdownView: View {
    enum Style { case hero, compact }
    init(to target: Date, style: Style = .compact)        // self-updating (TimelineView); hero = big numerals with unit labels
}
struct EnvelopeView: View {                              // Animatable on openProgress
    init(openProgress: Double, monogram: String, showsSeal: Bool = true)  // 0 = closed, 1 = flap fully open; aspect ≈ 1.45:1, fills width
}
struct CapsuleCard: View { init(capsule: TimeCapsule, now: Date) }   // list card for vault/horizon
struct MediaThumbnailView: View { init(url: URL, kind: MediaKind, maxPixelSize: CGFloat = 600) } // async thumbnail; fills its frame (clipped); play glyph for video, waveform for audio
enum TimePhrase {
    static func duration(from: Date, to: Date) -> String  // two largest units: "2 years, 3 months", "5 days, 4 hours", "12 minutes"
    static func relative(_ date: Date, now: Date = .now) -> String   // "in 2 years, 3 months" / "3 days ago"
    static func longDate(_ date: Date) -> String          // "Tuesday, 13 October 2026" (locale aware)
    static func moment(_ date: Date) -> String            // "a Tuesday evening in October"
}
```

## Features

```swift
struct RootView: View                    // Features/Vault – custom tab bar (Vault, Horizon, Styles) + prominent “Write” button;
                                         // fullScreenCover ComposeFlowView when router.isComposing;
                                         // fullScreenCover CapsuleDestinationView for router.presentedCapsuleID (look it up via modelContext/@Query)
struct VaultView: View                   // Features/Vault
struct HorizonView: View                 // Features/Vault – the river of time
struct ComposeFlowView: View { init(onFinish: @escaping (TimeCapsule?) -> Void) }  // Features/Compose – inserts & seals itself; nil when cancelled
struct ShareCapsuleSheet: View { init(capsule: TimeCapsule) }                      // Features/Compose – optional secret word + hint → export → ShareLink
struct CapsuleDestinationView: View { init(capsule: TimeCapsule) }                 // Features/Capsule – picks sealed / ceremony / reader; has its own close button (dismiss); applies .screenTheme(capsule.theme.theme)
struct StylesView: View                  // Features/Settings – style gallery + settings + import a .timeleaf (fileImporter)
struct LockScreenView: View              // Features/Settings
struct OnboardingView: View { init(onFinish: @escaping () -> Void) }               // Features/Onboarding
```

### Experience notes
- Capsule content (message, media, mood) is **never** shown while `state == .sealed`.
- Sealed screen: envelope + seal, hero countdown, “sealed on …, travelling for …”, progress, Share (outgoing
  to someone, not incoming), Delete (confirmation). Tapping the envelope: gentle shake + `Haptics.warning()` +
  “Not yet — 还未到时候” whisper.
- Ready → opening ceremony: glowing envelope, “Press and hold the seal”; hold ring fills with rising
  `Haptics.intensity`; seal breaks → `CeremonyBurst()` → flap opens → letter rises →
  `CapsuleActions.markOpened` → reader. Incoming capsules with `packageFileName != nil` are unpacked first
  (`CapsulePackage.unpack`), prompting for the secret word (show `passphraseHint`) when `requiresPassphrase`.
- Reader: “Written 1 year, 2 months ago — on a Tuesday evening in October”, title, mood, letter on
  `StationeryView`, media (photos full-screen zoom, `VideoPlayer`, audio with `AudioPlayback`), the prompt, and a
  “Write back to your past self” reply saved to `replyText`.
- Every capsule screen renders in the capsule's own style: `.screenTheme(capsule.theme.theme)`.
