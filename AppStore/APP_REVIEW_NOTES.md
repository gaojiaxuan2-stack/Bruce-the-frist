# App Review notes, App Privacy and age rating

This page has three parts:

1. **Notes for the App Review team.** Paste them into *App Store Connect → your version → App Review Information → Notes*. fastlane uploads the same text from [`metadata/review_information/notes.txt`](metadata/review_information/notes.txt), so keep the two in sync.
2. **App Privacy ("nutrition label") answers.**
3. **Age rating guidance** for Apple's age rating questionnaire (the 4+ / 9+ / 13+ / 16+ / 18+ system Apple introduced in 2025).

> **Check before every submission.** The notes describe the v2 feature set, and some of it (widgets, Siri shortcuts, Face ID lock, data export, the Settings rows) was still being built when this kit was written. Before you submit, run the **feature claim check** in [README.md](README.md#feature-claim-check-before-every-submission) and open the build you're shipping to confirm every button name and menu path in the notes (for example *Settings → Unhook Pro*, *Talk to your coach*). Delete any line whose feature isn't in the build. App Review rejects apps whose notes or metadata describe features that aren't there (Guideline 2.3.1).

---

## 1. Notes for the App Review team

**App Review Information fields**

| Field | Value |
|---|---|
| Sign-in required | **No.** Leave the demo account fields empty. |
| Contact first/last name, phone, email | A real person who can answer within a day during review. |
| Notes | The text below. |
| Attachment | Optional: a 20–30 second screen recording of onboarding → SOS → paywall helps if a reviewer gets stuck. |

**Notes text** (about 3,500 characters, under the 4,000 limit). This is a verbatim copy of `metadata/review_information/notes.txt`. Edit that file first, then paste it here, so the two never drift. Lines aren't wrapped on purpose: App Store Connect keeps every line break you paste.

```text
Thank you for reviewing Unhook.

NO LOGIN: Unhook has no accounts and no server. No demo account is needed. All data is stored on the device with SwiftData.

QUICK TEST (about 3 minutes)
1. Onboarding: pick a habit (for example Vaping), choose "Just now" or an earlier quit date, enter a rough daily cost, pick reasons, see the one-year projection, then choose whether to turn on reminders.
2. The last onboarding screen is the Unhook Pro paywall. Close it with the X in the top-right corner to continue on the free plan.
3. On the Today tab, open the habit to see the live streak, milestones and the recovery timeline.
4. Tap "Craving? Tap for SOS" on the Today tab to start guided breathing. SOS is free and never behind the paywall.
5. Tap "Talk to your coach" on the Today tab to try the coach.
6. Open the Progress tab for totals, charts, achievements and craving trigger insights. The top trigger is free; peak times and the full breakdown are Pro.

UNHOOK PRO (In-App Purchases, submitted with this version)
- unhook.pro.yearly: auto-renewable, 1 year, 1-week free trial for eligible new subscribers
- unhook.pro.monthly: auto-renewable, 1 month
- unhook.pro.lifetime: non-consumable, one-time purchase
Both subscriptions are in the "Unhook Pro" subscription group. Other ways to open the paywall: Settings > Unhook Pro, or try to add a second habit (+ on the Today tab) or a second savings goal. The free plan includes one habit and one active savings goal. Restore Purchases, Terms of Use and Privacy Policy are on the paywall. Pro unlocks unlimited habits and goals, full insights and alternate app icons (Settings > App Icon).

HEALTH AND SAFETY
- Unhook is a self-help tool and gives no medical advice. The recovery timeline shows general information with an in-app "not medical advice" note. The smoking timeline follows published WHO, CDC and NHS guidance; the alcohol timeline tells heavy daily drinkers to talk to a doctor before stopping.
- Crisis resources: Settings > Support > "Find a free helpline near you" opens findahelpline.com, a free directory of crisis and support lines by country. This is never paywalled.
- Habits such as porn, alcohol, cannabis and gambling appear only as things the user wants to quit. The app contains no sexual content, sells nothing age-restricted and has no gambling mechanics.

ON-DEVICE COACH
On devices running iOS 26 with Apple Intelligence turned on, coach replies come from Apple's on-device Foundation Models framework. On other devices a built-in scripted coach answers. Either way nothing is sent off the device and conversations are not saved. Messages about self-harm or crisis never reach the model: they get a fixed, caring reply that points to emergency services and helplines. The coach does not give medical advice.

PRIVACY
No analytics, no ads, no tracking, no third-party SDKs. The only network traffic is StoreKit (handled by Apple). App Privacy answer: Data Not Collected. Face ID is optional and only locks the app. Data export creates a file that the user shares through the system share sheet.

OTHER FEATURES TO TRY
- Widgets: add the Unhook "Streak" or "Craving SOS" widget from the Home Screen or Lock Screen widget gallery.
- Siri and Shortcuts: say "Open SOS in Unhook" to Siri, or find Unhook's App Shortcuts (SOS Breathing, Log Beaten Craving, Check My Streak) in the Shortcuts app and Spotlight. No setup is needed.
- Notifications are local only (daily pledge reminder and milestone alerts).

Contact: REPLACE_ME_CONTACT_EMAIL
```

### How you (and App Review) test Pro with the sandbox

App Review tests In-App Purchases in the **sandbox** automatically. You don't create anything for them, but these things must be true:

1. The **Paid Applications Agreement** is active (*App Store Connect → Business*), with banking and tax forms complete. Until it is, `Product.products(for:)` returns nothing and the paywall shows no prices, which is a common rejection.
2. All three products are **"Ready to Submit"**, each with a display name, a description, a price and an App Review screenshot of the paywall.
3. **For the first version only:** select the three products in the *In-App Purchases and Subscriptions* section of the version page before you click *Add for Review*. New IAPs can only be reviewed together with a binary.

To test it yourself:

| Where | How |
|---|---|
| Simulator / Xcode | The shared scheme points at `Unhook.storekit` (a StoreKit configuration file at the repository root), so purchases work with no account. **The file has to exist:** if it's missing, create it in Xcode (*File → New → File → StoreKit Configuration File*, saved as `Unhook.storekit` at the root) with the three products, the "Unhook Pro" group and the 1-week trial on yearly. In Xcode use *Debug → StoreKit → Manage Transactions* to refund, expire or renew. |
| TestFlight | TestFlight builds use the sandbox automatically. Testers are never charged. Subscriptions renew on an accelerated schedule and stop after a few renewals. |
| Device with a sandbox account | *App Store Connect → Users and Access → Sandbox → Test Accounts.* On the iPhone, sign in under *Settings → Developer → Sandbox Apple Account* (Developer Mode must be on; older iOS versions have it under *Settings → App Store*). Use a fresh sandbox account to see the free trial again; the introductory offer is once per subscription group. |

Checks worth doing before submission:

- [ ] Prices load on the paywall on a real device with a sandbox account (not only in the Simulator).
- [ ] Buying yearly shows the 7-day free trial in Apple's purchase sheet, and a sandbox account that already used the trial sees no trial wording on the paywall (it checks `isEligibleForIntroOffer`).
- [ ] Restore Purchases works after deleting and reinstalling the app.
- [ ] Refunding in *Manage Transactions* removes Pro (the store listens to `Transaction.updates`).
- [ ] The paywall shows the price, the billing period, what the trial converts to, and links to the Terms of Use and Privacy Policy (Guideline 3.1.2). Missing links are one of the most common subscription rejections.
- [ ] SOS, the crisis link, streaks, milestones and the recovery timeline all work with Pro off.
- [ ] Every Pro benefit the paywall names exists in the build. (When this kit was written, the insights paywall copy mentioned "places" and "where" cravings hit, but the app records no location. The integrator was asked to remove those words.)

---

## 2. App Privacy answers ("nutrition label")

Answer in *App Store Connect → App Privacy → Get Started*.

**Do you or your third-party partners collect data from this app?** → **No, we do not collect data from this app.**

The product page then shows **"Data Not Collected."** That's accurate for the code in this repository:

| Area | What the app does | Why it isn't "collected" |
|---|---|---|
| Habits, streaks, relapses, urges, triggers, notes, pledges, moods, savings goals | Stored on the device with SwiftData. | Never leaves the device. Apple defines "collect" as transmitting data off the device in a way you or your partners can access. |
| Purchases | StoreKit 2. | Apple processes payments. The app only receives signed transactions on the device. Apple doesn't count StoreKit as developer collection. |
| Coach | Apple's on-device Foundation Models framework where Apple Intelligence is available, otherwise a built-in scripted coach. Conversations aren't saved. | No prompt or output leaves the device, and nothing is sent to you or a third-party AI provider. |
| Widgets | Read habit data from an App Group container shared only by the app and its widget extension. | The App Group is on the device. Nothing is transmitted. |
| Face ID | `LocalAuthentication` only tells the app pass or fail. | Biometric data never reaches the app. |
| Data export | Writes a file the user chooses to share through the share sheet. | It's sent by the user, to a destination they pick. You never receive it. |
| Notifications | Scheduled locally. | No push server, no device token. |
| Crash reports | Only Apple's opt-in crash and energy reports (Xcode Organizer). | Collected by Apple from users who opt in to share with developers. No SDK. |

**The privacy manifest** (`Unhook/PrivacyInfo.xcprivacy`) agrees with this: `NSPrivacyTracking = false`, no tracking domains, no collected data types, and the required-reason API entry for `UserDefaults` (`CA92.1`). When the widgets ship, anything that reads App Group `UserDefaults` (`UserDefaults(suiteName:)`) also needs reason `1C8F.1`. That applies to the app's manifest and to a separate `PrivacyInfo.xcprivacy` in the widget extension. App Store Connect emails a warning after upload when a required reason is missing.

**When this label stops being true.** Update the label *and* the privacy manifest *before* you ship any of these:

- An analytics or attribution SDK, even a privacy-first one ([GROWTH_PLAYBOOK.md](GROWTH_PLAYBOOK.md) explains the trade-off).
- A crash reporter other than Apple's (Sentry, Crashlytics and similar).
- iCloud sync **through your own server**. CloudKit in the user's *private* database doesn't count as collection, because you can't read it.
- Community, accountability buddies, accounts or anything with a backend ([ROADMAP_100M.md](ROADMAP_100M.md)).
- A cloud AI model for the coach. That would also need explicit consent before sending personal data to a third-party AI (Guideline 5.1.2).

Keep the in-app copy honest at the same time. Settings currently says *"Unhook never sends your habits anywhere"*, and that must stay true.

**Privacy Policy URL** is still required with Data Not Collected. Start from [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

---

## 3. Age rating guidance

Unhook talks about smoking, vaping, alcohol, cannabis, porn and gambling **only as habits to quit**. Answer the questionnaire truthfully. Apple calculates the rating from your answers. Apple's guidance asks for the content as it really appears, so "references to quitting" still count as references.

Suggested answers (*App Store Connect → App Information → Age Rating → Edit*). The questionnaire's wording changes over time, so map these to the current questions:

| Question area | Suggested answer | Reason |
|---|---|---|
| Parental controls / age assurance features | No | None in the app. |
| Unrestricted web access | No | The app only opens fixed links (the helpline directory, Apple's Terms of Use and privacy pages) in Safari. It has no in-app browser. |
| User-generated content shared with others | No | Notes and reasons stay on the device. Change this if community features ship. |
| Messaging and chat | No | Change this if accountability buddies ship. |
| Advertising | No | No ads. |
| AI assistant / chatbot | **Yes**, if the questionnaire asks | The on-device coach generates text. Consider how often it could produce sensitive content (it's instructed to stay supportive and non-clinical). |
| Alcohol, tobacco or drug use or references | **Infrequent / Mild** | Preset names, reasons and recovery steps refer to quitting these substances. |
| Mature or suggestive themes | **Infrequent / Mild** | The "Porn" preset (habit name and reasons only). No sexual imagery. |
| Sexual content or nudity / graphic sexual content | None | None. |
| Gambling (real money) / simulated gambling / contests / loot boxes | None / No | "Gambling" is only a habit to quit. There are no gambling mechanics. |
| Medical or treatment information | **Infrequent / Mild** | General recovery information with a "not medical advice" disclaimer. |
| Health or wellness topics | **Yes** | Habit change and cravings. |
| Violence, horror, profanity, crude humor | None | None. |

**Expected outcome:** about **13+**. Under the old system, infrequent references to alcohol, tobacco or drugs and mild mature themes mapped to 12+, which became 13+. Your actual rating is whatever App Store Connect calculates.

**Overriding to a higher rating.** App Store Connect lets you choose a higher rating than the calculated one. Think about it before launch:

- **Stay at 13+** if you want to reach teens who vape. That's a large group trying to quit, and a public-health positive.
- **Choose 16+ or 18+** if you want less review friction around the porn preset, or if you plan paid campaigns limited to adults anyway.
- Ratings can differ by region. Some US states and other countries are adding age-assurance rules, and Apple provides the Declared Age Range API for apps that need it. Check whether any of these apply before each major release.

**Marketing stays 18+.** Whatever the store rating, aim paid ads and creator campaigns at adults (18+, or the local drinking/smoking age where it's higher). Never show nicotine products, alcohol or gambling in a positive light in creatives.
