# Unhook App Store launch kit

This folder has everything needed to get Unhook onto the App Store and growing: listing copy, screenshot plan, review notes, privacy answers and the growth plan. It's text only (Markdown and `.txt`), so it never affects the app build.

## What's in the kit

| File | What it's for |
|---|---|
| [`metadata/`](metadata) | App Store listing copy in fastlane `deliver` layout (see below). |
| [`SCREENSHOTS.md`](SCREENSHOTS.md) | The 8 screenshots: benefit-first headlines, which screen to capture, required device sizes, Custom Product Page sets. |
| [`APP_REVIEW_NOTES.md`](APP_REVIEW_NOTES.md) | Notes for App Review, how to test Pro in the sandbox, App Privacy answers ("Data Not Collected"), age rating guidance. |
| [Feature claim check](#feature-claim-check-before-every-submission) (below) | One command per feature the listing mentions, to prove it's in the build before you submit. |
| [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) | A privacy policy template that matches what the app does. You need a hosted policy URL to submit. |
| [`GROWTH_PLAYBOOK.md`](GROWTH_PLAYBOOK.md) | Go-to-market plan from 0 → 1M → 100M: positioning, ASO, creators, community, PR, partnerships, pricing, paywall tests, KPIs, analytics. |
| [`ROADMAP_100M.md`](ROADMAP_100M.md) | What the product needs beyond this repo to have a real shot at 100M users, prioritized with effort estimates. |

### `metadata/` layout

```
metadata/
  copyright.txt              "2026 <legal name>"            (not localized)
  primary_category.txt       HEALTH_AND_FITNESS
  secondary_category.txt     LIFESTYLE
  review_information/
    notes.txt                Notes for App Review, about 3,500/4,000 chars (same text as APP_REVIEW_NOTES.md)
  en-US/
    name.txt                 23/30 chars   "Unhook: Quit Bad Habits"
    subtitle.txt             30/30 chars   "Stop Smoking, Vaping, Drinking"
    keywords.txt             99/100 bytes  comma-separated, no spaces
    promotional_text.txt     154/170 chars  can change anytime without review
    description.txt          about 3,400/4,000 chars
    support_url.txt          placeholder: replace before upload
    marketing_url.txt        placeholder: replace, or delete the file
    privacy_url.txt          placeholder: replace before upload
```

There's deliberately **no `release_notes.txt`**. Version 1.0 has no "What's New", and every feature is new to App Store users, so the v2 feature list lives in step 8 as TestFlight *What to Test* text. Create `en-US/release_notes.txt` for your first update (step 11).

**Before any upload, replace every placeholder.** This command must print nothing:

```sh
grep -rn "REPLACE_ME" AppStore/metadata
```

Length limits App Store Connect enforces: name 30, subtitle 30, keywords 100 **bytes** (non-Latin scripts use 2–3 bytes per character), promotional text 170, description 4,000, What's New 4,000, App Review notes 4,000. When you localize, check bytes, not characters: `printf %s "$(cat keywords.txt)" | wc -c`. fastlane strips leading and trailing whitespace from every file, so the final newline doesn't count.

---

## Publishing, step by step

You need a Mac with a current Xcode (Xcode 26 or later in 2026). Apple raises the minimum SDK for App Store uploads every spring. CI also builds with Xcode 16.4 to prove the code still compiles there, but App Store Connect rejects uploads built with that older SDK, so **always archive with Xcode 26.x**. Plan on 1–2 days of setup and then 1–3 days for review.

### 1. Join the Apple Developer Program

- Enroll at developer.apple.com/programs ($99 per year). Choose **Organization** (needs a D-U-N-S number, free, can take a week or more) if you want a company name shown as the seller. **Individual** is faster but shows your personal name.
- In App Store Connect → **Business**, accept the **Paid Applications Agreement** and complete banking and tax forms. **In-App Purchases won't load, even in the sandbox, until this is active.**
- **EU Digital Services Act:** declare whether you're a *trader* (App Store Connect → Business, or the app's *Pricing and Availability*). If you charge money you're almost certainly a trader, and your address, phone and email will be shown on the EU product page. Apps without a trader declaration can't be distributed in the EU.
- Enroll in the **App Store Small Business Program** (developer.apple.com/app-store/small-business-program). Apple's commission drops from 30% to 15% while your proceeds stay under $1M a year. Subscriptions already drop to 15% after a subscriber's first year, either way.

### 2. Set your bundle identifier

The repo ships with the identifier `com.bruce.unhook`. Yours must be unique and registered to your team. Open *Unhook project → Build Settings*, search for `UNHOOK_BUNDLE_PREFIX` and follow whichever case applies:

- **The setting exists** (it arrives with the widget extension). It's a project-level *User-Defined* setting that holds the app's **full** bundle ID (default `com.bruce.unhook`). The other identifiers are derived from it: the widget extension is `$(UNHOOK_BUNDLE_PREFIX).widgets` and the tests are `$(UNHOOK_BUNDLE_PREFIX).tests`. Change it once, for example to `com.yourcompany.unhook`. Then check the App Group: the app's and the widget extension's `.entitlements` files must name the **same** group, and it must match the group identifier the code opens (search the Swift code for `group.`). If the group isn't derived from the setting, change it in all three places by hand.
- **The setting doesn't exist.** Change `PRODUCT_BUNDLE_IDENTIFIER` on the **Unhook** target (for example `com.yourcompany.unhook`) and on **UnhookTests**.
- In *Signing & Capabilities*, pick your **Team** for every target, with **Automatically manage signing** on. Xcode registers the App IDs, the **App Groups** capability and the provisioning profiles for you. App Groups need a paid developer account. If widgets show no data in a Debug build on your own iPhone, check whether the Debug configuration leaves the App Group entitlement out (a project can do that on purpose so a free Personal Team can still run the app). Release, TestFlight and App Store builds must include it.
- Capabilities to check on the App IDs: **In-App Purchase** (on by default) and **App Groups** (app and widget extension, same group). Siri/App Shortcuts, Face ID and local notifications need **no** extra capability. Face ID only needs `NSFaceIDUsageDescription`, which is already set.

### 3. Create the app record in App Store Connect

*Apps → + → New App*:

| Field | Value |
|---|---|
| Platform | iOS |
| Name | `Unhook: Quit Bad Habits`. Names are unique across the store. If it's taken, try `Unhook – Quit Any Habit` or `Unhook: Quit & Sober Tracker` (both ≤ 30 characters). The home-screen name stays "Unhook" either way (`CFBundleDisplayName`). |
| Primary language | English (U.S.) |
| Bundle ID | The one from step 2 |
| SKU | Any private ID, e.g. `unhook-ios` |
| User access | Full access |

Then in **App Information**:

- **Category:** Primary *Health & Fitness* (matches `LSApplicationCategoryType`), secondary *Lifestyle*.
- **Content rights:** "No, it does not contain, show, or access third-party content."
- **Age rating:** answer the questionnaire using [APP_REVIEW_NOTES.md](APP_REVIEW_NOTES.md#3-age-rating-guidance).
- **Privacy Policy URL:** your hosted copy of [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

### 4. Create the In-App Purchases

The IDs must match `Store.ProductID` in `Unhook/Services/Store.swift` **exactly**. Product IDs can never be reused, even after you delete one, so type them carefully.

**a) Subscription group** (*Monetization → Subscriptions → +*)

- Reference name: `Unhook Pro`. Localization → display name: `Unhook Pro`.

| Product ID | Type | Duration | Level in group | Suggested US price | Intro offer |
|---|---|---|---|---|---|
| `unhook.pro.yearly` | Auto-renewable | 1 year | **1** (top) | $29.99 | **Free trial, 1 week**, new subscribers, all territories |
| `unhook.pro.monthly` | Auto-renewable | 1 month | **2** | $4.99 | none |

- Putting yearly at a higher level than monthly makes monthly → yearly an **upgrade**, which Apple applies immediately with a prorated refund. Yearly → monthly is a downgrade that applies at the next renewal.
- People get **one introductory offer per subscription group**, and StoreKit decides who's eligible, so past subscribers may not see the trial again. The paywall already checks `isEligibleForIntroOffer` and only shows trial wording to people who can get it. Keep it that way, and never promise "free trial" in copy that everyone sees.
- The trial goes on yearly only. The paywall leads with it, and yearly gives the best retention.

**b) Lifetime** (*Monetization → In-App Purchases → +*)

| Product ID | Type | Suggested US price |
|---|---|---|
| `unhook.pro.lifetime` | **Non-consumable** | $59.99 |

**c) For each of the three products**

- Display name, 2–30 characters (e.g. "Unhook Pro Yearly"), and description, up to 45 characters (e.g. "Unlimited habits, goals, insights and icons", 43).
- Price: pick the US price and let Apple equalize the other 174 storefronts. Then adjust key markets by hand ([GROWTH_PLAYBOOK.md → Pricing](GROWTH_PLAYBOOK.md#10-pricing-and-regional-pricing)).
- **Review screenshot:** a screenshot of the paywall (any iPhone size).
- **Family Sharing:** decide before launch. **It can't be turned off once it's on.** The store code already handles shared purchases. Turning it on is generous and helps word of mouth. Leaving it off protects revenue per household.
- Status must reach **Ready to Submit**.

**d) Local testing:** the shared scheme points at `Unhook.storekit` at the repository root. If the file isn't there, Simulator purchases fail and the paywall shows "Purchases aren't available", so create it in Xcode (*File → New → File → StoreKit Configuration File*). Add the "Unhook Pro" subscription group with yearly (level 1, $29.99, 1-week free trial) and monthly (level 2, $4.99), plus the non-consumable lifetime ($59.99), using the same product IDs. Keep it in sync with App Store Connect, or Simulator testing will drift from production. (You can also start it with *Sync this file with an app in App Store Connect* once the products exist.)

### 5. Answer App Privacy

*App Privacy → Get Started → "No, we do not collect data from this app."* The full reasoning, and the list of changes that would make this answer false, is in [APP_REVIEW_NOTES.md](APP_REVIEW_NOTES.md#2-app-privacy-answers-nutrition-label).

### 6. Make the screenshots

Follow [SCREENSHOTS.md](SCREENSHOTS.md). You need **iPhone 6.9"** (and ideally 6.5") plus **iPad 13"**, with 8 frames each.

### 7. Archive and upload a build

1. Set the version: `MARKETING_VERSION` (currently `1.0`) and a build number `CURRENT_PROJECT_VERSION` that increases with every upload.
2. In Xcode choose *Any iOS Device (arm64)* → **Product → Archive** → *Distribute App → App Store Connect → Upload*.
3. **Export compliance:** the app uses no encryption of its own (StoreKit's HTTPS is exempt), so answer "None of the algorithms mentioned above". To skip the question for every build, set `ITSAppUsesNonExemptEncryption` to `NO`. The app target generates its Info.plist, so add the build setting `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` to the Unhook target's Debug and Release configurations (in Xcode: *Unhook target → Info → App Uses Non-Exempt Encryption → NO*). If your Xcode doesn't offer that key, just answer the question in App Store Connect.
4. Wait for processing (5–30 minutes) and fix anything in the email from App Store Connect (missing icons, privacy manifest issues, and so on).

### 8. TestFlight

- **Internal testing** (up to 100 people on your team): available right after processing, no review.
- **External testing** (up to 10,000 testers via email or a public link): the first build needs a short Beta App Review, usually under a day. Use *What to Test* to steer testers ("Try SOS during a real craving", "Buy Pro with the sandbox and restore it").
- Run at least **one week** with 20–50 real quitters before launch. Watch crashes in *Xcode → Organizer* and read every piece of feedback. This is where onboarding confusion shows up.

**What to Test** text for the v2 beta (edit to match the build, max 4,000 characters):

```text
Thanks for testing Unhook! Please try:
• Onboarding: pick a habit, set your quit date and daily cost, pick your reasons and see your one-year projection
• SOS during a real craving, then tag what set it off
• The recovery timeline on your habit's screen
• A savings goal on the Today tab
• Craving trigger insights on the Progress tab
• The coach ("Talk to your coach" on the Today tab)
• The Streak and Craving SOS widgets, the Siri shortcut for SOS, Face ID lock and data export
• Unhook Pro: buy with the sandbox (you won't be charged), then delete and reinstall the app and tap Restore Purchases
Tell us anything confusing, broken or missing. Screenshots help.
```

### 9. Upload metadata (fastlane, optional)

You can paste everything by hand, or let fastlane upload this folder:

```sh
brew install fastlane
# Create an App Store Connect API key first (Users and Access → Integrations → App Store Connect API).
fastlane deliver \
  --api_key_path ./asc_api_key.json \
  --app_identifier com.yourcompany.unhook \
  --metadata_path ./AppStore/metadata \
  --skip_binary_upload true \
  --skip_screenshots true \
  --force true
```

- **What's New:** the kit has no `release_notes.txt` because version 1.0 has no "What's New" (current fastlane skips the file on a first version anyway). From the first update on, create `metadata/en-US/release_notes.txt` (step 11).
- **Contact details for App Review** can go in `metadata/review_information/` as `first_name.txt`, `last_name.txt`, `phone_number.txt` and `email_address.txt`, or be typed into App Store Connect once. Personal details don't belong in a public repo, so keep those files untracked. `deliver` never sends empty values, and with no demo account files it marks sign-in as not required.
- Keep the API key file out of git.

### 10. Submit for review

On the version page:

- [ ] [Feature claim check](#feature-claim-check-before-every-submission) passed for this build, and any line about a missing feature deleted
- [ ] Build selected, screenshots uploaded for every required size
- [ ] Description, keywords, support URL and privacy URL with no placeholders left
- [ ] **In-App Purchases and Subscriptions:** all three products selected (first submission only)
- [ ] App Review Information: contact details, **sign-in not required**, notes pasted from [`APP_REVIEW_NOTES.md`](APP_REVIEW_NOTES.md)
- [ ] Release option: choose **Manually release this version** so you control launch day (Product Hunt, press, creators)
- [ ] Optionally turn on **Phased Release** (7 days, auto-updates only) for updates after launch

Then **Add for Review → Submit**. Most reviews finish within 24–48 hours.

**Common rejections for this type of app, and how the kit prevents them**

| Guideline | Risk | Prevention |
|---|---|---|
| 3.1.2 | Paywall missing price, period, trial terms, or Terms/Privacy links | Paywall checklist in APP_REVIEW_NOTES.md; Terms of Use and Privacy lines in `description.txt` |
| 2.1 | IAPs not loading during review | Paid Applications Agreement active; IAPs submitted with the version |
| 1.4.1 | Health claims | Recovery timeline cites sources and says "not medical advice"; copy never promises outcomes |
| 2.3.1 / 2.3.7 | Metadata describes missing features, or uses trademarks in keywords | Feature claim check before submitting; no third-party brand names in the description or keywords (no "NoFap", "Dry January", competitor names) |
| 5.1.1 | Privacy policy missing or not reachable | PRIVACY_POLICY.md hosted and linked from the listing and the paywall |

### 11. Launch day and after

Follow the launch timeline in [GROWTH_PLAYBOOK.md](GROWTH_PLAYBOOK.md#2-stage-plan-0--1m--100m). For every update: bump `MARKETING_VERSION` and the build number, write `metadata/en-US/release_notes.txt` with only what changed in that version (warm and specific, for example "Fixed a bug where the streak could show the wrong day after a time-zone change"), refresh `promotional_text.txt` (it can change without review), re-run the feature claim check, and reply to new reviews in App Store Connect.

---

## Feature claim check (before every submission)

The listing, the review notes and the screenshot plan mention the features below. Several were still being built when this kit was written. Run these from the repository root against the commit you're archiving. Each command must print at least one line (or the number shown). If one prints nothing, the feature isn't in the build: **delete every mention of it** in `metadata/en-US/description.txt`, `metadata/review_information/notes.txt` (and its copy in APP_REVIEW_NOTES.md), SCREENSHOTS.md and the TestFlight text before you submit. Guideline 2.3.1 rejections for missing features are common and avoidable.

| # | Claim | Where it's mentioned |
|---|---|---|
| 1 | "Streak" and "Craving SOS" widgets (Home Screen and Lock Screen) | description, review notes, screenshot 8 |
| 2 | Siri and Shortcuts (opening SOS) | description, review notes |
| 3 | Face ID lock | description, review notes, privacy policy, screenshot 8 |
| 4 | Data export | description, review notes, privacy policy |
| 5 | Full-screen milestone celebrations | description, screenshot 6 |
| 6 | Rating prompt after celebrations, and no other prompts | GROWTH_PLAYBOOK.md §3 |
| 7 | "Talk to your coach" on the Today tab | review notes, screenshot 7 |
| 8 | Settings > Unhook Pro, Settings > App Icon | review notes |
| 9 | 13 milestones, 12 achievements | description |
| 10 | Free plan: 1 habit and 1 active savings goal | description, review notes |
| 11 | Coach runs on the device, no network except StoreKit | description, review notes, privacy policy |

```sh
# 1  widgets (prints the two widget names)
grep -rn -e 'configurationDisplayName("Streak")' -e 'configurationDisplayName("Craving SOS")' --include='*.swift' .
# 2  Siri / App Shortcuts
grep -rn "AppShortcutsProvider" --include='*.swift' .
# 3  Face ID lock
grep -rn "LAContext" --include='*.swift' Unhook
# 4  data export: find the row, then tap it in the app and check that it produces a file
grep -rni "export" --include='*.swift' Unhook/Views/Settings
# 5  celebrations (both names must appear as declarations)
grep -rnE "(struct|enum|class) (MilestoneCelebrationView|CelebrationCenter)" --include='*.swift' Unhook
# 6  rating prompt
grep -rnE "(struct|enum|class) ReviewPrompter" --include='*.swift' Unhook
# 7  coach entry on the Today tab
grep -rn "CoachEntryCard(" --include='*.swift' Unhook/Views/Home
# 8  Settings rows (then open Settings and check the row titles match the notes word for word)
grep -rn -e "showPaywall(.settings)" -e "setAlternateIconName(" --include='*.swift' Unhook
# 9  must print 13, then 12
grep -c "Milestone(seconds:" Unhook/Models/Milestone.swift
grep -c "Achievement(id:" Unhook/Models/Achievement.swift
# 10 must show "= 1" twice
grep -n "static let free" Unhook/Models/Monetization.swift
# 11 must list only the helpline, Terms of Use and Apple privacy links, and no URLSession
grep -rnE "URLSession|https?://" --include='*.swift' Unhook
```

Two checks need App Store Connect rather than the code: the yearly plan's introductory offer is a 1-week free trial (and `Unhook.storekit` matches), and the UNHOOK PRO list in the description still matches the paywall's benefits. If anything else becomes Pro-only (the coach or the widgets, for example), add it to that list.

Also open the build and walk through the review notes' QUICK TEST exactly as written. Button names change during development, and App Review follows the notes literally.
