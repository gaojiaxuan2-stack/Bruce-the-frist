# Roadmap to 100M: what the product needs beyond this repo

This repository is a strong iOS app: on-device, account-free, covering every habit, with a sharing loop built in. It isn't yet a product that can plausibly reach 100M users. This page lists what's missing, in priority order, with honest effort estimates.

**Effort key:** *ew* = engineer-weeks for one experienced engineer, including tests and polish but not App Review time. Ranges show uncertainty. Non-engineering work (content, legal, research, moderation) is listed separately.

> These are estimates for planning, not commitments. Re-estimate each item when it's picked up.

## Summary

| # | Item | Priority | Engineering effort | Other effort | Depends on | Why it matters for 100M |
|---|---|---|---|---|---|---|
| 1 | Web landing page, privacy policy, support, press kit | **P0** | 1–2 ew | Copy, design | – | Required to submit; home for SEO, press and partners |
| 2 | Localization (about 15 languages, then 30–40) | **P0** | 3–4 ew (first 15) | Translation vendor, native review | – | Most of the world doesn't search in English |
| 3 | Accessibility pass | **P0** | 2–3 ew | Testing with real users | – | Reaches more people, wins featuring, it's the right thing to do |
| 4 | Store safety: versioned schema and migrations | **P0** | 1–2 ew | – | – | A bad migration at 10M users is a catastrophe |
| 5 | Data import (from export) and device migration | **P1** | 1–2 ew | – | Export (v2) | Switching phones and moving to Android without losing streaks |
| 6 | iCloud sync via CloudKit (private database) | **P1** | 3–5 ew | – | 4 | Data survives a new iPhone; makes Watch and iPad work together |
| 7 | Apple Watch: SOS on the wrist and streak complications | **P1** | 4–6 ew | Design | 6 (or WatchConnectivity) | Cravings happen when your phone isn't in your hand |
| 8 | Share card v2 and "quit together" links | **P1** | 1–2 ew | Design | 1 (domain) | Multiplies the organic loop |
| 9 | Challenges and In-App Events | **P1** | 2–3 ew | Seasonal content | – | Seasonal spikes (January, October) and App Store featuring |
| 10 | Localized quitline directory | **P1** | 1–2 ew | Quarterly upkeep | 2 | Safety, and the door to quitline partnerships |
| 11 | Live Activities (SOS, milestone countdown) and HealthKit mindful minutes | **P1** | 2–3 ew | – | – | Daily presence on the Lock Screen; Apple-platform depth |
| 12 | **Android app** | **P1** (start in Stage 2) | 16–26 ew to parity | Play Store listing, QA on low-end devices | 5, 2 | About 70% of the world's phones. 100M doesn't happen without it. |
| 13 | **Clinical advisory board and evidence base** | **P1** (start early, long lead time) | 2–4 ew (study tooling) | 6–24 months, budget | – | Unlocks insurers, employers, public health and press credibility |
| 14 | **Anonymous community and accountability buddies** | **P2** | 6–10 ew (buddy MVP); 6–12 months (full) | Trust and safety team, legal | Backend, 13 | Network effects and retention, but the highest-risk item here |
| 15 | Web content hub (quit guides) | **P2** | 2–4 ew | Advisor-reviewed content | 1, 13 | Huge organic search ("how to quit vaping") that leads into the app |
| 16 | B2B tooling (employers, health plans) | **P2** | 2–4 ew | Sales | 13 | Distribution through benefits at scale |
| 17 | Local habit presets (snus, shisha, betel/areca nut, bidi) | **P2** | about 0.5 ew each | Advisor review | 2, 13 | Relevance in high-growth markets |

**Suggested sequence**

| Quarter | Items |
|---|---|
| **Q1** (launch) | 1, 2, 3, 4 |
| **Q2** | 5, 6, 8, 9, 10; form the advisory board (13) |
| **Q3** | 7, 11; start Android (12); evidence mapping (13) |
| **Q4** | Android beta; pilot study (13); buddy MVP design (14) |
| **Year 2** | Android launch; 30–40 languages; community (14) if safety is staffed; B2B (16); content hub (15) |

---

## 1. Web landing page, privacy policy, support, press kit (P0, 1–2 ew)

- A static site (no tracking scripts; privacy-friendly web analytics only, if any) with:
  - a hero, the App Store badge and screenshots
  - a privacy page (from [PRIVACY_POLICY.md](PRIVACY_POLICY.md)) and a support page with a contact email and FAQ
  - a press kit (icon, screenshots, 30-second video, fact sheet, founder bio)
- Serve `/.well-known/apple-app-site-association` from the same domain so universal links ("quit together", item 8) work. It's a static file, so no server is needed.
- Smart App Banner meta tag, Open Graph images built from the share card design.

## 2. Localization (P0, 3–4 ew for the first 15 languages)

- **Already planned (phase 3):** app strings and App Store metadata in about 15 languages. The code follows `String(localized:)` rules, so String Catalogs pick everything up.
- Engineering: pseudo-localization runs (long German strings, accented characters), plural rules, number, currency and date formats (`MoneyFormatter` already takes a currency code), screenshots per language.
- **Keywords are researched per market, not translated** (see GROWTH_PLAYBOOK.md §3).
- Wave 3 (30–40 languages) adds **right-to-left** (Arabic, Hebrew, Urdu, Persian): mirrored layouts, chart direction, the breathing animation. Budget about 1–2 ew for right-to-left QA.
- Non-engineering: professional translation plus a native reviewer per language. Health content (recovery timelines, coach guardrails) should be reviewed by a native-speaking clinician once the advisory board exists.

## 3. Accessibility (P0, 2–3 ew)

- **VoiceOver:** full onboarding, SOS (announce "Breathe in / Hold / Breathe out" with timing), charts (audio graphs or summaries), celebrations.
- **Dynamic Type** up to the largest accessibility sizes without truncating the streak counter.
- **Reduce Motion:** a calm alternative to the confetti and the breathing animation. **Increase Contrast** and color-blind-safe chart colors.
- Haptics as an alternative to visual breathing cues (and on the Watch, item 7).
- Declare supported features in App Store Connect's **Accessibility Nutrition Labels** once they're available for your app. They show on the product page.
- Test with real users of assistive technology. A few paid sessions find more than any checklist.

## 4. Store safety: versioned schema and migrations (P0, 1–2 ew)

- Today `AppModelContainer.make()` falls back to an **in-memory store** if the on-disk store can't open. That keeps the app alive, but to the user **it looks like all their data is gone**, and anything they enter in that session is lost.
- Before any model change ships: adopt `VersionedSchema` plus a `SchemaMigrationPlan`, add migration tests from every shipped schema version, and show a "we couldn't open your data, nothing has been deleted" screen with an export option instead of silently starting empty.
- Keep the store's file protection at iOS's default (`completeUntilFirstUserAuthentication`) and never raise it to `complete`. Widgets read the shared store while the phone is locked, and with `complete` they'd fail until the user unlocks.
- Make **Erase all data** cover every model type, and add a test that fails when a new `@Model` isn't erased. (When this was written, erase skipped `SavingsGoal`, while the privacy policy promises everything is removed.)

## 5. Data import and device migration (P1, 1–2 ew)

- Make the v2 export format a **documented, versioned JSON schema**, and add **import** with duplicate detection by `uuid`.
- This is how people move to a new phone without iCloud, and later how they move between iOS and Android (item 12).

## 6. iCloud sync via CloudKit (P1, 3–5 ew)

- The models are mostly shaped for CloudKit already: every property has a default, the to-one sides (`Relapse.habit`, `Urge.habit`) are optional with inverses, and there are no unique constraints. Keep it that way.
- **One known gap:** CloudKit requires *every* relationship to be optional, so the to-many arrays `Habit.relapses` and `Habit.urges` will most likely have to become optional (`[Relapse]?`). That's a schema change, so do item 4 first.
- Work involved:
  - iCloud capability and container (`iCloud.` plus the app's bundle ID, e.g. `iCloud.com.yourcompany.unhook`; `UNHOOK_BUNDLE_PREFIX` holds the full bundle ID)
  - `ModelConfiguration(cloudKitDatabase: .private(...))`
  - a store location that works with the App Group for widgets
  - a Settings toggle and sync status
  - deduplicating records that can be created twice offline (e.g. two `Pledge`s for the same day)
  - testing on two devices with airplane-mode conflicts
- **CloudKit production schemas are additive only.** You can't rename or delete fields once deployed, so plan model changes carefully (item 4).
- **Privacy:** data lives in the user's **private** iCloud database, which the developer can't read, so "Data Not Collected" still holds.
- **Pricing decision:** sync is a common Pro perk, but losing your streak on a new phone feels punitive for a quit app. Consider free sync, with Pro for the extras.

## 7. Apple Watch (P1, 4–6 ew)

- **SOS on the wrist:** breathing guided by haptics, with your reasons shown on screen. Cravings often hit while driving, at a bar or in a meeting, when the phone isn't out.
- **Complications and Smart Stack widgets** for the streak (WidgetKit accessory families on watchOS).
- **"I beat a craving" logging** from the wrist.
- Data via CloudKit (item 6) or WatchConnectivity as an interim. Watch-only SOS should work offline.

## 8. Share card v2 and "quit together" links (P1, 1–2 ew)

- A 9:16 story format, milestone-specific designs (1 week, 30 days, 100 days, 1 year), and an optional App Store QR code or short link on the card.
- A universal link (`https://<domain>/quit/vaping`) that opens onboarding with that habit preselected, or the App Store if the app isn't installed.
- Suggest sharing on the celebration screen, but never require it.

## 9. Challenges and In-App Events (P1, 2–3 ew)

- Time-boxed, opt-in challenges ("30 days alcohol-free in January", "World No Tobacco Day: 24 hours free", "7-day scroll detox") with their own badge and share card.
- Each one can be published as an **App Store In-App Event**. These appear in search and editorial, but need a real in-app experience behind them.
- Use generic names unless you partner with the campaign owner (Dry January, Stoptober and the Great American Smokeout are trademarks).

## 10. Localized quitline directory (P1, 1–2 ew plus upkeep)

- An offline, bundled list of country → free helplines by habit (tobacco quitline, alcohol and drugs, gambling, crisis). Show it in SOS and Settings, with findahelpline.com as the fallback.
- Review it quarterly. Numbers change, and a wrong crisis number is a safety issue.
- A good list opens doors with quitlines and public-health bodies (see GROWTH_PLAYBOOK.md §8).

## 11. Live Activities and HealthKit (P1, 2–3 ew)

- A **Live Activity / Dynamic Island** during SOS, and on milestone days ("2h until 1 week").
- **HealthKit (optional, write-only):** save SOS sessions as Mindful Minutes. Data stays in the Health app on the device, and the App Privacy label doesn't change. App Review expects a clear purpose string and a privacy policy, which you already have.

## 12. Android app (P1, 16–26 ew to parity, about 4–6 months with 1–2 engineers)

**Why:** about 70% of smartphones worldwide run Android, and in the high-growth, high-smoking markets (India, Indonesia, Brazil, Nigeria, Pakistan, the Philippines) the share is far higher. Without Android, 100M isn't realistic.

**Recommended approach: native Kotlin and Jetpack Compose, with shared content and test vectors.**

- **Stack:** Room (storage), Play Billing Library, Glance (widgets), WorkManager/AlarmManager (local reminders; Android 13+ needs notification permission), Material 3. Keep Unhook's own design language.
- **Product IDs:** Google Play allows the same IDs (`unhook.pro.yearly`, `unhook.pro.monthly`, `unhook.pro.lifetime`). Keep them identical across stores.
- **Share content, not code:** move presets, milestones, recovery timelines and coach guardrails into a **versioned JSON content pack** that both apps read. Write **golden test vectors** (inputs → expected streak, savings, milestone and recovery progress) that both test suites run, so the math never drifts.
- Kotlin Multiplatform isn't worth it right now: the iOS logic already exists in Swift, and rewriting it adds risk without user value. Revisit if the shared logic grows a lot.
- **On-device coach:** use the platform's on-device model where available (e.g. Gemini Nano through Android's on-device AI APIs, on supported phones), with the same scripted fallback as iOS.
- **Low-end devices:** test on 2–3 GB RAM phones and older Android versions, and keep the APK small. That matters in growth markets.
- **Play Store:** Data safety form ("No data collected"), a content rating questionnaire (IARC), store listing localization.
- **Cross-platform sync:** iCloud doesn't work on Android. Real cross-platform sync needs your own backend with end-to-end encryption, which changes the privacy story. Defer it, and rely on export/import (item 5).

## 13. Clinical advisory board and evidence base (P1, start early, 6–24 months)

**Why:** insurers, employers, quitlines, health systems, serious press and Apple's editors all ask the same question: *does it work?* Today the honest answer is "it uses sensible techniques, but there's no outcome data yet."

| Step | When | What |
|---|---|---|
| Advisory board | Months 0–3 | 3–5 paid advisors: an addiction-medicine physician, a tobacco treatment specialist, a clinical psychologist (CBT/ACT), a behavioral scientist and a person with lived experience of recovery. Publish who they are. |
| Content review | Months 1–4 | Advisors review every recovery timeline, SOS copy, slip flow, the coach's guardrails and crisis routing. Add citations in the app where useful. |
| Evidence mapping | Months 3–9 | Map features to established behavior-change techniques (e.g. the BCT Taxonomy): self-monitoring, goal setting, implementation intentions, urge surfing, reframing costs as savings. Close gaps (for example "if-then" plans for top triggers). |
| Pilot study | Months 6–18 | With a university partner: ethics/IRB approval, pre-registration, and an **opt-in, separately consented** study mode (the only place data leaves the device, with its own privacy terms). Outcomes such as self-reported abstinence at 1, 3 and 6 months, and engagement. |
| Randomized trial and publication | Months 12–24+ | A peer-reviewed trial (for smoking, ideally with biochemical verification). This is what opens insurer and public-health contracts. |

**Regulatory line:** stay a **general wellness** product (no diagnosis or treatment claims) until evidence and funding justify going further. Claiming to treat dependence turns the app into a medical device (FDA in the US, MDR in the EU, MHRA in the UK; Germany's DiGA program also needs CE marking plus evidence). That route is real but takes years and significant budget.

Engineering: 2–4 ew for the consented study mode and data handling. Non-engineering: advisor fees, research partner costs, legal.

## 14. Anonymous community and accountability buddies (P2, highest risk)

**Why:** quitting with others improves retention and creates network effects, which is the strongest growth loop available. **Risk:** it needs a backend, so data is collected. It brings moderation duties, legal obligations and real safety risks in a vulnerable population. Do it only when you can staff it.

**Build it in stages:**

1. **No server (1 ew):** "Send a check-in" shares your streak status through Messages or WhatsApp. Low risk, and it shows whether people want it.
2. **Buddy MVP (6–10 ew plus backend operations):** pseudonymous handles, pairing by habit and time zone, **predefined messages only** ("Still going 💪", "Rough day", "Proud of you") plus streak sharing. No free text means much less moderation.
3. **Full community (6–12 months):** groups per habit, free text, reactions, with a full trust and safety program.

**Requirements before free text ships:**

- **App Store Guideline 1.2:** content filtering, a report button with timely responses, blocking users, and published contact information.
- **18+ only** for community features, with age assurance where the law requires it.
- **Crisis routing:** detect crisis language and show local helplines right away. Peers must never be the only safety net.
- **Moderation:** trained human moderators (in-house or a trust and safety vendor) covering the time zones you serve, plus anti-spam (vape, drug and gambling-affiliate sellers will target these spaces).
- **Legal:** the EU Digital Services Act (notice and action, transparency), GDPR and UK GDPR, US state privacy and health-data laws, and a data protection impact assessment.
- **Privacy:** update the App Privacy label, privacy manifest and policy. Keep the core app usable with no account, so people who never join the community keep "no account, nothing collected".

## 15. Web content hub (P2, 2–4 ew plus ongoing content)

- Advisor-reviewed guides ("How to quit vaping", "What happens when you stop drinking", "How to handle cravings at night"), money-saved calculators per habit and country, and printable quit plans.
- These rank for very high-volume searches and lead into the app through Smart App Banners and the "quit together" links.
- No ad trackers, and only privacy-friendly web analytics.

## 16. B2B tooling (P2, 2–4 ew)

- Employer and health plan landing pages, bulk offer-code distribution, and an aggregate, **opt-in** outcome survey. Report to the buyer without individual data, which is a selling point.
- Needs item 13 for health plans. Employers can start earlier.

## 17. Local habit presets (P2, about 0.5 ew each)

- Snus (Nordics), shisha/hookah (Middle East), betel and areca nut (South and Southeast Asia, Taiwan), bidi (India), each with costs, units, reasons and an advisor-reviewed recovery timeline.
- Small effort, big relevance in growth markets.

---

## Team shape by stage (rough)

| Stage | Users | Team |
|---|---|---|
| Launch | 0–100k | Founder (iOS) plus a part-time designer; contractors for localization and the landing page |
| Growth | 100k–1M | + iOS engineer, + growth/content marketer, + part-time community and support |
| Scale | 1M–10M | + 2 Android engineers, + backend engineer (if community ships), + partnerships lead, + trust and safety, + clinical/research lead (part-time) |
| Platform | 10M+ | Dedicated teams per platform, growth, partnerships, trust and safety, research, support, localization |

Because the core app has no server, infrastructure cost stays near zero as usage grows. Most of the cost at scale is **people**: support, moderation, localization, partnerships and research.

## What we deliberately won't do, even to grow faster

- No ads business model, no selling or sharing data, no tracking SDKs.
- No cloud AI for the coach without explicit consent (and preferably not at all).
- No shame-based or manipulative mechanics: no streak-loss threats in notifications, no fake urgency on the paywall, no gambling-like rewards.
- No paywall on crisis help (SOS, helplines), ever.
- No medical claims we can't back with evidence.
