# Screenshot plan

Most people decide from the first three screenshots in search results, often without opening the product page. So every frame leads with a **benefit headline** (what the user gets), and the in-app screen is the proof underneath it.

## Sizes required (checked October 2026)

Unhook runs on iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`), so you need iPhone **and** iPad screenshots.

| Slot in App Store Connect | Accepted portrait sizes (px) | Required? | Capture on (Simulator) |
|---|---|---|---|
| **iPhone 6.9"** | 1320 × 2868, 1290 × 2796, 1260 × 2736 | Upload this. App Store Connect needs either 6.9" or 6.5" and scales them down for smaller iPhones. | iPhone 17 Pro Max or iPhone 16 Pro Max (1320 × 2868) |
| **iPhone 6.5"** | 1284 × 2778, 1242 × 2688 | Only required if you skip 6.9". Recommended anyway, so older large iPhones get a crisp, not scaled, image. | iPhone 14 Plus or iPhone 13 Pro Max (1284 × 2778) |
| **iPad 13"** | 2064 × 2752, 2048 × 2732 | **Required**, because the app runs on iPad. | iPad Pro 13-inch (M4 or later) (2064 × 2752) |

Rules that apply to every slot:

- 1–10 screenshots per slot per language. Plan on **8**.
- PNG or JPEG, **no transparency or alpha channel**. If a design tool exports PNG with alpha, flatten it or export as JPEG.
- Show the real app. Device frames and captions are fine, but the UI must be genuine (Guideline 2.3.3), with no fake reviews, no "#1" claims and no prices that might change.
- Apple's sizes change from time to time. Check *App Store Connect Help → Screenshot specifications* before a big upload.
- Optional **app preview videos**: up to 3 per slot, 15–30 seconds, recorded from the app. A 20-second "craving → SOS → craving crushed" clip is the strongest candidate.

## Getting clean, realistic data

- **Status bar.** Before capturing, run `xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`.
- **Capture.** Run `xcrun simctl io booted screenshot 01-streak.png`.
- **Plausible numbers.** In onboarding, choose **"Earlier"** on the quit date step to backdate habits (for example vaping 34 days ago at $8/day, alcohol 12 days ago at $15/day). The counters then show real-looking progress, made by the app itself. Keep numbers believable: about $300 saved after a month reads as honest, $9,000 reads as fake.
- **Variety without clutter.** The free tier allows one habit, so buy Pro in the Simulator through the StoreKit configuration (`Unhook.storekit`, see README step 4d) to show two or three habits and the full trigger insights. Remember that backdating a habit makes the app celebrate the latest milestone already reached the next time the Today tab is active, so expect a celebration screen after each backdated habit you add.
- **Both themes.** Shoot frames 1–7 in light mode. Frame 3 (SOS) and frame 7 (coach) can be dark for contrast; the app looks right in both.
- **Text size.** Use the default Dynamic Type size. Captions go **above** the device, with text at least about 90 px tall on a 1320 px-wide canvas, so they stay readable as thumbnails.
- **No personal data** in notes, reasons or goals. Use friendly sample text such as "Breathe easier", "New headphones" or "Trip to Lisbon". Avoid other companies' product names in anything that appears in a screenshot.

## The 8 frames

The first three carry the conversion. Their order should answer: *What is it? Why will it work for me? Can I trust it?*

| # | Headline (benefit-first, max about 6 words) | Sub-caption (optional, small) | Screen to capture | Set-up notes |
|---|---|---|---|---|
| 1 | **Quit anything. One day at a time.** | Smoking, vaping, drinking, scrolling and more | **Habit detail hero**: the live "FREE FOR" counter (days, hours, minutes, seconds), progress ring and next milestone | Vaping habit backdated about 34 days. Choose a moment when the seconds look lively. This frame doubles as the search-result thumbnail. |
| 2 | **Watch your savings grow every second** | Money, time and cravings won back | **Today tab**: savings banner plus habit cards, with a **savings goal** partly funded | Add a goal such as "New headphones" so it shows a partly filled progress bar. Use the local currency in localized sets. |
| 3 | **A 60-second reset for cravings** | Guided breathing with *your* reasons | **SOS screen** mid-breath ("Breathe in"), with the "REMEMBER WHY" reasons visible | Dark background works well. Make sure your own reasons show, not placeholders. |
| 4 | **See what's getting better, day by day** | Recovery timeline for every habit | **Recovery timeline card** on the habit detail screen, with "Up next" and some steps reached | Use the **smoking** timeline (it cites WHO, CDC and NHS). Don't crop out the "not medical advice" line if it's in frame. |
| 5 | **Know your triggers. Outsmart them.** | Spot when and why cravings hit | **Progress tab**: craving trigger insights card plus the "Cravings beaten · last 14 days" chart | Beat about 15 cravings in SOS and tag a trigger each time, so the chart and insights have real data. Peak times and the full breakdown are Pro, so buy Pro in the Simulator first, or the card shows the free teaser. |
| 6 | **Celebrate every milestone** | Share your wins with the people who matter | **Milestone celebration** ("MILESTONE UNLOCKED", full screen, confetti), with the **share card** as an overlay or split frame (tap *Share my progress*) | Add a habit backdated a little past 7 days (for example 7 days and 1 hour). When the Today tab is active again, the app shows the "1 Week" celebration right away, because it celebrates the latest milestone already reached. Capture during the confetti. |
| 7 | **A private coach in your pocket** | Runs on your device. Nothing leaves it. | **Coach** (*Talk to your coach* on the Today tab) answering a realistic message ("I always want a drink after work") | Every device gets the coach: Apple's on-device model where Apple Intelligence is on (iOS 26+), a built-in scripted coach elsewhere. Capture whichever you like, but don't caption it "AI" unless the caption also says it needs Apple Intelligence. For locales where the coach's replies aren't translated yet, swap in the daily pledge and mood screen. Don't let a reply that sounds like medical advice into the frame. |
| 8 | **Private by design** | No account · Face ID lock · Widgets | **Composite**: Lock Screen with the Streak widget, next to the Face ID lock screen or the Settings privacy row ("Your data stays on your iPhone") | Lock Screen widgets need a device-like wallpaper, so a mock-up frame is fine as long as the widget is real. Only use this frame once the widgets and Face ID lock pass the README's feature claim check. Otherwise drop those words from the sub-caption and show the Settings privacy row alone. |

### iPad 13" set

Use the same 8 headlines. iPad users see more at once, so:

- Frame 1: habit detail, scrolled so the hero counter and the top of the recovery timeline are both in view. The app doesn't have a two-column iPad layout, so don't mock one up.
- Frame 5: the full Progress tab, which shows totals, the chart and triggers together.
- Frame 8: skip the Lock Screen composite and show the widget gallery with the Streak and SOS widgets instead.

Don't stretch iPhone screenshots onto an iPad canvas. App Review rejects that (Guideline 2.3.3).

## Variants worth testing

Run these with **Product Page Optimization** in App Store Connect (up to 3 treatments against the original, split by percentage of traffic). Results reach confidence faster on high-traffic storefronts, so test in the US first.

1. **Frame 1 headline**: "Quit anything. One day at a time." vs. a money-first "See what quitting gives back" over the onboarding one-year projection. Don't put a promised amount ("You'll save $1,000") or a made-up testimonial ("Like Sam…") in a screenshot: both read as claims you can't back up (Guideline 2.3.1, and the FTC treats invented testimonials as deceptive).
2. **Order**: SOS first (frames 3, 1, 2…) vs. the streak first. People who search "craving" may convert better on SOS.
3. **Icon**: the alternate icons (Midnight, Sunrise, Forest) are already in the binary, which is what PPO icon tests need.

## Per-habit sets for Custom Product Pages

Build one Custom Product Page per big habit, each with its own first three frames, and assign keywords from the keyword field to it (see [GROWTH_PLAYBOOK.md](GROWTH_PLAYBOOK.md)). Keywords can only be assigned from your **latest approved** version, so this starts after the first release is approved:

| Page | Frame 1 headline | Keywords to assign (from `keywords.txt`) |
|---|---|---|
| Vaping | "Quit vaping. Breathe easier." | nicotine |
| Drinking | "Your sober counter, done kindly" | sober, sobriety, alcohol |
| Porn | "Take back your focus" (keep visuals neutral, no suggestive imagery) | porn |
| Screen time | "Put the phone down. Get your time back." (don't claim to "reset" dopamine, which is a physiological claim) | dopamine, detox, screen, time |
| Gambling | "Protect your money. Rebuild trust." | gambling |
| Sugar | "Cut back on sugar, one day at a time" | sugar |

Apple recommends a unique set of keywords for each page, so give each keyword to one page only. Only words from the keyword field are offered for assignment, so words in the app name or subtitle (quit, smoking, vaping, drinking…) keep pointing at the default page. Check *App Store Connect Help → Custom product pages* for the current rules before you set this up.

## File naming

Use one folder per language and device, so fastlane `deliver` can upload them later if you choose to:

```
AppStore/screenshots/en-US/
  01-streak_iphone69.png   01-streak_iphone65.png   01-streak_ipad13.png
  02-savings_iphone69.png  …
```

`deliver` reads the device type from the image dimensions. The leading number sets the order.
