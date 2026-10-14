# Timeleaf · 时笺

> *Dear Future,* — write to the person you are becoming.

**Timeleaf** is an iOS app for letters to the future. Film a video, take photos,
record your voice and write a letter, then choose a day and seal it. Nobody can
open it before that day, not even you. You can write to *Future Me* or to someone
dear, who receives it as an encrypted `.timeleaf` file.

**时笺** (*shí jiān*) is pronounced exactly like **时间**, "time". **笺** is fine
letter paper. So the name means both *time* and *a letter written across time*.

<p align="center"><img src="Timeleaf/Assets.xcassets/AppIcon.appiconset/AppIcon.png" width="160" alt="Timeleaf icon: a wax seal stamped 时 on an envelope under an aurora sky"></p>

## The six styles

Every screen, seal and sheet of paper changes with the style you choose. Each
letter also remembers the style it was written in, so it opens exactly as its
author saw it.

| Style | | Mood |
|---|---|---|
| **Aurora** | 极光 | Your words, held in drifting northern light. Glass orb seal, breathing mesh-gradient sky. |
| **Parchment** | 信笺 | Sealed in wax, kept by time. Oxblood wax seal, paper grain, postmarks. |
| **Ink Wash** | 水墨 | Where the brush rests, the mist begins. Vermilion 印章 chop, misty mountains, 八行笺 eight-column letter paper. |
| **Celestial** | 星河 | Written in the stars, opened in their time. Gold astrolabe seal, twinkling Milky Way, the Big Dipper turning around Polaris. |
| **Blossom** | 花信 | News of spring, pressed between pages. Pressed-flower seal, falling sakura. |
| **Monolith** | 极简 | Precise as a clock. Quiet as a promise. Clock-face seal, hairline grid, one signal-orange tick. |

## What you can do

- **Write a letter**
  - Choose who it's for: *Future Me*, or *Someone dear*.
  - Write on the style's own stationery. A mood and a "Need a spark?" prompt (24 of them) help you start.
- **Add memories:** photos and videos from your library, the camera (photo or video), and voice notes with a live waveform.
- **Choose the day:** one tap for 1 month to 10 years or next New Year's Day, or pick any date and time.
- **Seal it:** press and hold the seal. A ring fills, the haptics build, and the seal stamps down.
- **While it's sealed:**
  - You see the envelope, a live countdown and how far along its journey it is.
  - Tapping it only whispers *"Not yet — 还未到时候"*.
  - You get a notification when it arrives, plus one halfway through for journeys of a month or longer.
- **Open it:** on the day, a glowing envelope invites you to hold the seal until it cracks. A style-specific burst plays (ink bloom, petal swirl, starburst…), the flap opens and the letter rises.
- **Read it:**
  - *"Written 2 years, 3 months ago — on a Tuesday evening in October"*, then the letter, its photos, videos and voice notes.
  - A space to write back to your past self.
- **Share a letter:**
  - The letter becomes an encrypted `.timeleaf` file you can send with AirDrop, Messages or Mail. You can add a secret word and a hint.
  - The recipient opens the file in Timeleaf. It stays sealed until the day, then they need the secret word.
- **Vault & Horizon:**
  - The Vault holds letters ready to open, in transit, received, and opened.
  - The Horizon is a river of time: memories above *Now*, sealed letters below.
- **Privacy:** an optional Face ID / passcode lock that covers every screen. Media is stored with complete file protection. Nothing leaves the device unless you share it.

## Open it in Xcode

Requirements: **Xcode 16 or newer** (Xcode 26 is fine), iOS **18.0+** device or simulator.

1. Clone the repo and open **`Timeleaf.xcodeproj`**.
2. Select the **Timeleaf** target → *Signing & Capabilities* → choose your **Team**.
   Change the bundle identifier (`com.timeleaf.app`) if Xcode asks for a unique one.
3. Pick an iPhone simulator or your device and press **Run** (⌘R).

The project uses Xcode's *synchronized folder* format: any file you add under
`Timeleaf/` is picked up automatically.

If your Xcode can't open the project, generate an equivalent one with
[XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen && xcodegen generate`
(it reads `project.yml`). Or create a new iOS App project named **Timeleaf**,
delete its template Swift files, drag in the `Timeleaf/` folder, and set *Info.plist File* to
`Support/Info.plist` (that file declares the `.timeleaf` document type).

**Testing notes**
- The camera needs a real device; the camera option is hidden in the simulator, but the photo library and voice notes work there.
- To see a letter open without waiting years, seal one for a near date and time, such as tomorrow, then change the date on a test device. Or temporarily lower the earliest date allowed in `ComposeDraft.earliestUnlockDate`.

## How it's built

SwiftUI + SwiftData + Observation, Swift 5 language mode, no third-party packages.

```
Timeleaf/
  App/         app entry, AppShell (theme, onboarding gate, file import), privacy lock window
  Core/        SwiftData models (TimeCapsule, CapsuleMedia), Theme tokens, settings keys, router
  Themes/      the six styles: tokens + animated background + seal + unsealing burst + stationery
  Services/    MediaStore, VoiceRecorder/AudioPlayback, CameraPicker, Haptics,
               CapsulePackage (encrypted .timeleaf), NotificationScheduler, AppLock, CapsuleActions
  Components/  themed cards & buttons, CountdownView, 3D EnvelopeView, CapsuleCard, thumbnails
  Features/    Vault & Horizon, Compose (writing → sealing → sharing), Capsule (sealed → ceremony → reader),
               Settings (style gallery, lock screen), Onboarding
Support/Info.plist   .timeleaf document type
docs/CONTRACT.md     the internal API contract every module follows
```

**The `.timeleaf` file format**
- Layout: `"TLEAF1"`, then a JSON header, then an AES-GCM sealed payload.
- The header (sender, recipient, title, unlock date, style) is readable, so the envelope can be shown before opening. It is also the AES-GCM *authenticated data*, so editing the unlock date breaks decryption.
- With a secret word, the key comes from PBKDF2-SHA256 (210,000 rounds).

**What "sealed" means here.** The date is enforced by the app, and letters you receive stay encrypted on disk until they are opened. A determined person with full access to the phone, or who changes the device clock, could get around it. Timeleaf is a promise kept by design, not a bank vault.

