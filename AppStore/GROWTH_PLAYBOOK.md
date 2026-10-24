# Unhook growth playbook: 0 → 1M → 100M

A practical go-to-market plan for Unhook, built on what the app really does today: personalized onboarding with a one-year projection, live streaks, 13 milestones with full-screen celebrations, shareable progress cards, 60-second SOS breathing, craving triggers and insights, a recovery timeline per habit, savings goals, a private on-device coach, widgets, Siri shortcuts, Face ID lock, data export, and Unhook Pro (yearly with a 7-day trial, monthly, lifetime). Some of these were still being built when this was written; [README.md](README.md#feature-claim-check-before-every-submission) has a check for each one, and nothing here should be promoted until it's in the shipping build.

> **Honesty first.** Nothing here guarantees an outcome. Every number labelled **Target** is a goal to steer by, not an industry fact or a forecast. Check targets against your own data and against Apple's peer-group benchmarks in App Store Connect, and change the plan when the data says so.

---

## 0. Reality check: what "100M users" takes

- **Define the number.** "100M users" usually means **cumulative downloads**. Monthly active users will be a fraction of that, because most installs of any habit app stop opening it within a month. Track both, and never quote downloads as active users.
- **The math.** 100M installs in 5 years is about **55,000 installs a day, every day**, averaged across all countries. Over 7 years it's about 39,000 a day. That's top-of-category volume, sustained for years.
- **Who has done it.** Only a handful of consumer health apps (period trackers, meditation and calorie counters) report 100M+ downloads. All of them are on **iOS and Android**, available in **dozens of languages**, and took many years to get there.
- **What's already in Unhook's favor.** There's no server, so the app's running cost barely changes whether it has 1,000 users or 100M. It covers every habit in one app, it's private by design (rare in health), and sharing is built in (milestone moments plus share cards).
- **What's missing.** An Android app (about 70% of the world's smartphones, and the large majority in India, Indonesia, Brazil and Africa), more languages, an evidence base that partners trust, and a way for users to bring each other in. See [ROADMAP_100M.md](ROADMAP_100M.md).

**Paid ads can't carry this on their own.** As a rough illustration: if 3% of installs end up paying about $25 net in their first year, each install is worth about $0.75 in year one. Paid installs in the US often cost several dollars. Paid acquisition only pays off once retention and conversion are strong, so **organic search, sharing and partnerships have to drive most of the growth.**

---

## 1. Positioning

**One line:** *Quit anything. Privately.*

**Positioning statement:** For anyone trying to quit something, Unhook is the kind, private quit companion that works for **any** habit. It's unlike single-habit apps or screen-time blockers: it counts what you gain, gets you through a craving in 60 seconds, and never asks for an account.

### Who it's for, in priority order

| # | Segment | Why them | Main hook in the app |
|---|---|---|---|
| 1 | **Quitting vaping**, ages 18–34 | Large, growing, share-heavy, live on TikTok and Instagram | Share cards at milestones, money saved, SOS |
| 2 | **Quitting smoking**, ages 30–60 | Highest intent, biggest money saved, strong evidence base | Recovery timeline (WHO/CDC/NHS), savings goals |
| 3 | **Sober and sober-curious** (alcohol) | Huge, seasonal spikes (January, October) | Sober counter, kind slip flow, mood chart |
| 4 | **Porn, doomscrolling and "dopamine detox"**, mostly men 18–30 | Highly engaged, underserved by respectful apps | Privacy, Face ID lock, triggers, coach |
| 5 | **Gambling** | High stakes, fewer good tools, partnership potential | Money protected, crisis resources |
| 6 | **Sugar, caffeine, junk food, nail biting** | Broad, low-stigma, easy to talk about publicly | Streaks, light-hearted sharing |

### Message pillars (use in every channel)

1. **Private.** No account, no ads, no tracking, "Data Not Collected" on the App Store.
2. **Kind.** A slip resets the streak, never your progress. No shame, ever.
3. **Rewarding.** Watch money and time come back every second, and save toward something real.
4. **There when it's hard.** SOS breathing with *your* reasons in 60 seconds, always free.

### Words to avoid

"Cure", "treatment", "clinically proven" (until it is), "guaranteed", "99% success", "heal your body", "rewire your brain", "reset your dopamine", "addict" as a label for people, before-and-after body claims, promised savings amounts, and fear or shame tactics. They break App Store rules (1.4.1, 2.3.1), invite regulator attention, and go against the brand.

---

## 2. Stage plan: 0 → 1M → 100M

Each stage has a **gate**. Don't move money or people into the next stage until the gate is met. Growth on top of weak retention only burns money.

### Stage 0: before launch (weeks −6 to 0)

- **Landing page, privacy policy and support page** live (needed to submit, see [README.md](README.md)).
- **TestFlight** with 50–200 real quitters recruited from your own network and from communities that allow it (see §5). Watch for where people drop out of onboarding.
- **Social accounts** on TikTok, Instagram and YouTube. Film a backlog of **30 short videos** (formats in §4).
- **Apple featuring nomination**, submitted in App Store Connect as early as you can (Apple asks for advance notice; aim for 6+ weeks before launch, and check the current guidance on the nomination form). Editors look for great design, accessibility, localization and current Apple technologies. Unhook has widgets, App Intents and on-device AI, so make that case in the nomination.
- Optional: put the app up for **pre-order** (up to 180 days ahead) so launch-day downloads land together.
- Pick a launch date: a **Tuesday–Thursday**, ideally 2–6 weeks before a seasonal moment (§7).

### Stage 1: launch → 10k installs (months 0–2)

- Release manually on launch day. Same day: Product Hunt (§6), founder posts, community posts where allowed.
- Seed **20–30 nano creators** (§4).
- **Apple Ads** (formerly Apple Search Ads) test at **$20–50 a day** in the US. Use exact-match campaigns on *quit vaping, quit smoking, sober counter, stop drinking, habit tracker*, plus one Search Match campaign to discover new terms. Add the terms that convert to `keywords.txt`, and add negatives for terms that don't.
- Reply to **every** review within 48 hours.
- **Gate to Stage 2 (Targets):** D7 retention ≥ 15%, rating ≥ 4.6, crash-free sessions ≥ 99.5%, trial-to-paid ≥ 30%. Gates are the *minimum* needed to move on; the §12 targets are what you aim for, so some gate values sit below them on purpose.

### Stage 2: 10k → 1M (months 2–12)

- **Localization** into about 15 languages, with localized keywords and screenshots (§3).
- **Custom Product Pages** per habit, with keywords assigned to each (§3).
- **Creator program** with 50–200 creators a month, and boosting of the posts that work (Spark Ads, partnership ads).
- **In-App Events** for seasonal challenges. These need a matching challenge in the app (roadmap item).
- **January push.** January is typically the biggest month for quit and habit apps. Plan creative from October.
- **PR** (§7) and **partnership pilots** (§8).
- Paid ads beyond Apple Ads (Meta, TikTok) only with privacy-preserving attribution (AdAttributionKit / SKAdNetwork), and only while the payback rules in §12 hold.
- **Gate to Stage 3 (Targets):** 12-month LTV / CAC ≥ 1.5 on paid channels, organic ≥ 60% of installs, D30 ≥ 8%.

### Stage 3: 1M → 10M (years 2–3)

- **Android launch.** This is the single biggest unlock.
- iCloud sync, Apple Watch, 25+ languages, a regional pricing team.
- **Clinical advisory board** and a first published outcome study, which open insurer and public-health doors.
- **B2B2C:** employer wellness and health plans.
- Community and accountability buddies, but only if built with real moderation (roadmap).
- Team of about 8–15: iOS, Android, design, growth, community, support, partnerships.

### Stage 4: 10M → 100M (years 3–7)

- **Android-first growth markets** with high smoking or vaping rates and fast smartphone growth: India, Indonesia, Brazil, Mexico, the Philippines, Vietnam, Pakistan, Nigeria, Türkiye, Egypt. They need local pricing, local quitlines, low-end device performance and local creators.
- **Public-health partnerships** (quitlines, ministries of health, NGOs). They distribute at scale when the evidence holds up.
- **Network effects:** quitting together, buddies, challenges between friends.
- 40+ languages including right-to-left scripts (Arabic, Hebrew, Urdu, Persian).
- Expect this stage to depend more on partnerships and Android distribution than on App Store search.

---

## 3. App Store Optimization (ASO) per market

### How the listing is built (en-US, see `metadata/en-US/`)

| Field | Content | Why |
|---|---|---|
| Name (30) | `Unhook: Quit Bad Habits` | Brand plus the broad "quit … habits" intent. The name carries the most ranking weight. |
| Subtitle (30) | `Stop Smoking, Vaping, Drinking` | The three highest-volume quit searches. Apple combines words across fields, so *quit smoking*, *quit vaping*, *stop drinking* and *stop smoking* all match. |
| Keywords (100 bytes) | `sobriety,sober,counter,tracker,porn,dopamine,detox,screen,time,sugar,free,nicotine,alcohol,gambling` | Completes phrases like *sobriety counter*, *habit tracker*, *quit porn*, *dopamine detox*, *screen time*, *sugar free*, *nicotine free*, *quit alcohol*, *quit gambling*. "free" also matches "free habit tracker" searches. |

**Keyword rules**

- Never repeat a word already in the name or subtitle.
- Use singular forms, commas with no spaces, and no "app".
- **No trademarks or competitor names**: no "NoFap", "Dry January", "Stoptober" or other apps' names (Guideline 2.3.7). Use generic phrasing instead ("porn free", "alcohol-free January").
- `porn` is a plain, descriptive word that respectful quit-porn apps already use on the store. If App Review objects, swap it for `urges` and move porn messaging to its Custom Product Page.

**Rotation (every 4–6 weeks).** Check your rank per keyword and Apple Ads' search popularity. Replace terms where you rank outside the top 50 with strong alternatives: `weed`, `cannabis`, `vape`, `cigarette`, `relapse`, `craving`, `streak`, `recovery`, `addiction`, `clean`. A change to the subtitle or keywords ships with an app update, so batch them.

### Custom Product Pages (CPPs) with keywords

Since mid-2025, App Store Connect lets you assign keywords from your **latest approved version's** keyword field to a Custom Product Page, so that page shows up in organic search for those terms (up to 70 pages per app at the time of writing). Apple recommends a unique set of keywords per page, and only keyword-field words are offered, so name and subtitle words stay with the default page. This starts after the first approval. Build one page per big habit (frames in [SCREENSHOTS.md](SCREENSHOTS.md#per-habit-sets-for-custom-product-pages)):

- Vaping → `nicotine`
- Drinking → `sober`, `sobriety`, `alcohol`
- Porn → `porn`
- Screen time → `dopamine`, `detox`, `screen`, `time`
- Gambling → `gambling`
- Sugar → `sugar`

Also use CPP links in creator bios and ads, so each one opens with the frames that fit its audience.

### Product Page Optimization (PPO)

Test icon, screenshots and order, with up to 3 treatments against the original. The **alternate icons (Midnight, Sunrise, Forest) are already in the binary**, which PPO icon tests require. Run one test at a time in the US (most traffic) for at least 2 weeks, or until App Store Connect shows enough confidence.

### Markets and localization

Research localized keywords in each language rather than translating them. Use native speakers and Apple Ads search popularity per storefront.

| Wave | Storefronts | Local notes |
|---|---|---|
| 1 (launch, English) | US, UK, Canada, Australia, Ireland, New Zealand | UK: "stop smoking" and "vape" are common. Australia: since 2024 vapes are sold only through pharmacies, so quit demand is high. |
| 2 (localization phase) | Germany, Austria, Switzerland; France; Spain and Mexico; Brazil; Italy; Netherlands; Japan; Korea | German "Nichtraucher" and "Rauchen aufhören"; French "arrêter de fumer"; Spanish "dejar de fumar", "sobriedad"; Brazilian Portuguese "parar de fumar", plus sports betting ("apostas"); Japanese 禁煙 (quit smoking) and 禁酒 (quit drinking); Korean 금연 |
| 3 | Nordics, Poland, Türkiye, Indonesia, India (English and Hindi), Philippines, Vietnam, Arabic-speaking markets | Sweden and Norway: snus ("sluta snusa"). Türkiye and Indonesia: very high smoking rates. Arabic needs right-to-left layout testing. |
| Separate project | China mainland | Requires a government app filing (ICP) and usually a local partner. Budget time for it. |

- The **US storefront also indexes some additional localizations** (for example Spanish (Mexico)). Check Apple's localization reference, and use them for genuinely localized Spanish copy, not keyword stuffing.
- **Seasons drive search.** January (resolutions, alcohol-free January), late May (World No Tobacco Day, 31 May), September (Recovery Month in the US), October (sober October, the UK's quit-smoking month), November (the US Great American Smokeout, third Thursday). Refresh promotional text and In-App Events for each.

### Ratings and reviews

- The app already asks for a rating **right after milestone celebrations**, at most a few times a year. Don't add more prompts.
- Reply to every 1–3 star review within 48 hours, kindly and specifically. Fix what comes up repeatedly, then say so in release notes.
- **Target:** rating ≥ 4.7 with a steadily growing count.

---

## 4. Creator and UGC strategy (TikTok, Instagram Reels, YouTube Shorts)

The product already makes the content: **every milestone is a story, and every share card is an ad that users make themselves.**

### Content pillars (owned accounts and creator briefs)

| Pillar | Format | App moment |
|---|---|---|
| **Day X check-in** | "Day 1 vs. day 30 of quitting vaping", posting the share card each week | Share card, milestones |
| **What's changing in my body** | Walk through the recovery timeline: "3 days without nicotine: here's what's happening" | Recovery timeline. Cite its sources and never go beyond them. |
| **What I bought with it** | "I quit and saved $412, so I bought…" with the savings goal filling up | Savings goals. A good fit for personal-finance creators. |
| **Live craving** | Filming yourself riding out a craving with SOS, then the "Craving crushed!" screen | SOS |
| **Milestone reaction** | Reacting to the full-screen celebration at 1 week, 1 month or 100 days | Milestone celebration |
| **My trigger** | "Turns out I crave most at 9 PM when I'm bored" | Trigger insights |
| **Ask the coach** | Showing the on-device coach answering a real craving moment, and pointing out that it runs on the phone | AI coach |

**Owned channels:** post 1 short video a day for the first 90 days. Rotate pillars, test hooks in the first 2 seconds, and repost the best creator content (with written permission).

### Creator program

| Tier | Followers | Deal (rough market ranges; they vary widely by niche and country) | Role |
|---|---|---|---|
| Nano | 1k–10k | A year of Pro (offer code) plus a small flat fee or none | Authenticity, volume, sharp audiences such as #QuitTok and #SoberTok |
| Micro | 10k–100k | Flat fee per video (often a few hundred dollars) plus a performance bonus | Core engine. Boost winners with Spark Ads or partnership ads. |
| Mid/macro | 100k+ | Negotiated, in seasonal bursts only | January, World No Tobacco Day, October |

- **Recruit** people who are actually quitting, or who are open about recovery. Real streaks beat scripted ads. Niches: quit-vaping, sobriety, fitness, personal finance, ADHD/dopamine, faith communities, gaming (for doomscrolling and gaming habits).
- **Measure** with a Custom Product Page or a campaign link (`https://apps.apple.com/app/apple-store/id<APP_ID>?pt=<provider token>&ct=<creator>&mt=8`) per creator. App Store Connect reports downloads and proceeds per campaign for users who share analytics, so treat the numbers as a sample.
- **Disclosure:** every paid post uses the platform's paid-partnership label plus a clear "#ad" (FTC in the US, ASA/CMA in the UK, local equivalents elsewhere).

### Creator brief: dos and don'ts

**Do**

- Show the real app with a real streak.
- Talk about money, time, mood and pride.
- Mention it's private with no account.
- Say slips are OK.

**Don't**

- Make medical claims or promise results.
- Show or handle vapes, cigarettes, alcohol or gambling in an appealing way.
- Feature minors, or target under-18 audiences in nicotine, alcohol or porn content.
- Shame anyone ("addict", "disgusting").
- Show suggestive imagery in porn-recovery content (keep it to focus, energy and connection).
- Run fake countdowns or "limited time" claims.

### Product changes that would multiply UGC

These are roadmap items, not in the app yet:

- Add a 9:16 story template for the share card, with an App Store QR code or short link.
- Add milestone-specific card designs (1 week, 30 days, 100 days, 1 year).
- Suggest sharing on the celebration screen, without ever requiring it (Apple prohibits making features depend on sharing or reviews).

---

## 5. Community seeding (Reddit, Discord and others)

**Rule zero: be a person first, not a promoter.** These communities exist for people in hard moments, and spam hurts them as well as you.

### Reddit

- Relevant communities include r/stopsmoking, r/QuitVaping, r/stopdrinking, r/leaves (cannabis), r/problemgambling, r/pornfree, r/nosurf, r/digitalminimalism, r/sugarfree and r/decaf. For app-maker posts, try r/iOSapps and the scheduled self-promotion threads on larger Apple subreddits.
- **Read every sidebar.** Several of these communities ban self-promotion entirely (recovery subreddits are often strict). Respect that, and don't try to get around it.
- **Participate for weeks before mentioning the app.** Then **message the moderators first** and ask whether a one-time "I built this, feedback welcome" post, an AMA, or free Pro codes for members would be welcome.
- **Always say you're the developer.** Never use alternate accounts, vote manipulation, paid comments or fake testimonials. Reddit bans for them, and the FTC treats fake reviews as deception.
- Prefer giving over asking: answer questions, share what helps with cravings, and mention the app only when it's genuinely relevant.

### Your own Discord (from Stage 2)

- Channels per habit, a daily check-in channel, a #milestones channel (share cards land here naturally), and #feedback.
- **18+ only**, given the topics.
- **Moderation:** AutoMod plus trained volunteer moderators, with written rules (no shaming, no medical advice, no selling).
- **Crisis protocol:** pin local helplines. Moderators point people to professional and crisis services and never try to counsel someone in crisis themselves.
- Staff it before you promote it. An empty or unmoderated server does more harm than having none.

### Other places

- Facebook groups (older quitters, strongest for smoking), local quit-smoking and recovery meetups, university wellbeing services.
- The same rules apply everywhere: ask the admins, disclose, add value.

---

## 6. Product Hunt

- **When:** after 2–4 weeks live, so you have ratings and early stories. Launch Tuesday–Thursday at 12:01 AM Pacific.
- **Assets:** tagline (*"Quit anything, privately. No account, no tracking."*), 5–8 gallery images (the screenshot set), a 30-second video, and a first comment from the maker telling the real story and saying what feedback you want.
- **Offer:** for example 3 months of Pro free with an offer code, or a launch-day lifetime price. Make sure the offer is real and honored in the app.
- **Rules:** tell your network the launch is live, but don't ask for upvotes directly. Product Hunt penalizes vote solicitation and vote rings.
- **Realistic impact:** a few hundred to a few thousand installs. The lasting value is credibility, backlinks and press interest, not volume.

---

## 7. PR angles

| Angle | Hook | Proof you need |
|---|---|---|
| **The habit app that collects nothing** | Health data privacy is a live worry (health apps, data brokers, new state health-data laws) | Screenshot of "Data Not Collected"; offer an independent review of the code or network traffic |
| **An AI coach that never leaves your phone** | On-device AI is a mainstream tech story | A demo video; explain the safety approach |
| **Gen Z is quitting vaping and posting their streaks** | Trend story built on creator content | 3–5 real users willing to be interviewed (with consent) |
| **What quitting is actually worth** | Personal finance: "a pack-a-day smoker could save $X a year" | Public price data per state or country. **Not** user data, because you don't collect any. Optionally an opt-in survey. |
| **Indie maker story** | A small team building a privacy-first health app | Founder story, launch numbers you're comfortable sharing |
| **Seasonal** | January, World No Tobacco Day (31 May), Recovery Month (September), October, Great American Smokeout (November) | A pitch 4–6 weeks before each date |

- **Press kit** on the landing page: icon, screenshots, a 30-second video, fact sheet, founder bio and photos, contact. Offer journalists TestFlight or promo codes ahead of launch, under embargo.
- **Targets:** health and wellness editors, personal-finance writers, Apple-focused blogs and newsletters, and tech reporters who cover privacy. Personalize every pitch. A short, specific email beats a press release.
- **Trademarks:** campaigns such as *Dry January*, *Stoptober* and the *Great American Smokeout* belong to their organizers. Use generic wording unless you partner with them. Partnering is a good idea (§8).

---

## 8. Partnerships

| Partner | What they want | What Unhook offers | Realistic timeline |
|---|---|---|---|
| **Employers** (wellness benefits) | Healthier, more productive staff; evidence of use | Pro for employees through **offer codes**. Zero individual data shared, which is a selling point. Aggregate results come from an opt-in survey. | Pilots in 3–9 months. Start with 200–2,000-employee companies or benefits platforms. |
| **Health plans and insurers** | Measurable outcomes (for example quit rates at 6 months), security review | Needs the **evidence base** first (roadmap). The no-data design makes the security review simpler, because no health information is exchanged. | 12–24 months |
| **Quitlines and public health** (US state quitlines, NHS stop-smoking services, national quitlines) | Reach younger people; digital support between counselling sessions | Prominent "talk to a free quitline" links by country in SOS and Settings; co-branded challenges | 3–12 months; government procurement is slow |
| **Nonprofits** (lung health, alcohol charities, gambling-harm charities) | Tools for their audience | Free Pro codes for their programs; licensed use of campaign names (e.g. an official alcohol-free January partner) | 1–6 months |
| **Universities** | Research partners, student wellbeing | Pilot studies (see the evidence plan in ROADMAP_100M.md), student Pro codes | 6–18 months |
| **Apple** | Great apps that showcase the platform | Featuring nominations for every major release (widgets, App Intents, Apple Intelligence, Watch) | Ongoing |

**Be careful with** nicotine-replacement brands, pharmacies and alcohol-free drinks brands. Sponsorship can be fine, but keep editorial independence, never let sponsors shape health content, and follow medical-advertising rules in each country.

**Useful quitlines to link** (check numbers before shipping): US 1-800-QUIT-NOW (tobacco), US SAMHSA helpline 1-800-662-4357 (substance use), US 988 (crisis), US 1-800-GAMBLER (gambling), England NHS Smokefree 0300 123 1044, Australia Quitline 13 7848, UK and Ireland Samaritans 116 123. For everywhere else, findahelpline.com, which the app already links to.

---

## 9. Referrals and word of mouth

The app has share cards and a "Tell a friend" row. Ideas in order of effort:

1. **Better share cards** (low effort): an App Store link or QR code on the card, a 9:16 story size, milestone-specific designs.
2. **"Quit together" link** (medium): share a universal link that opens Unhook with the same habit preset preselected. It needs a domain plus a static `apple-app-site-association` file, but no server.
3. **Give a month of Pro** (medium): Pro users get a custom offer code to share. Without a server you can't credit individual referrers, so keep it a gift, not a reward.
4. **Family Sharing** for Pro (setting in App Store Connect, see README step 4).
5. **Accountability buddies** (high, needs a backend; ROADMAP_100M.md).

**Never:**

- Reward ratings or reviews.
- Lock features behind sharing, or require sharing to use the app (App Store Review Guidelines prohibit both).
- Pre-fill messages that pretend to be from the user.

---

## 10. Pricing and regional pricing

### Launch prices (US, a starting point to test, not a final answer)

| Plan | Price | Notes |
|---|---|---|
| **Yearly** `unhook.pro.yearly` | **$29.99** with a 7-day free trial, selected by default | About 50% less than 12 × monthly. Best retention. |
| Monthly `unhook.pro.monthly` | $4.99 | Mostly an anchor. Some people want to try a month. |
| Lifetime `unhook.pro.lifetime` | $59.99 | About 2× yearly. Many quitters are trying to *save* money and dislike subscriptions, so lifetime catches them instead of losing them. |

**Free stays genuinely useful:** one habit, one active savings goal, SOS, streaks, milestones, recovery timeline, pledges and share cards. **Crisis help is never paywalled.**

**Honest framing that also converts:** the onboarding already knows the user's daily cost. A line like *"Pro costs less than 8 days of vaping"* (yearly price ÷ daily cost, shown only when daily cost > 0) is true, personal and persuasive.

### Regional pricing

- Apple equalizes prices from your base storefront using exchange rates and taxes. That leaves lower-income markets **much** too expensive.
- **Set key markets by hand** using a purchasing-power reference (for example World Bank PPP data). As a starting point, consider 25–50% of the US price in India, Indonesia, the Philippines, Vietnam, Pakistan, Egypt and Nigeria, and 40–70% in Brazil, Mexico, Türkiye and Eastern Europe. Keep Western Europe, the UK, Australia and Japan close to US parity (including VAT).
- Review quarterly, because currency moves shift these. Apple also adjusts prices when taxes or exchange rates change.

### Other levers

- **Small Business Program:** 15% commission under $1M proceeds a year (README step 1).
- **Introductory offers** on the yearly plan (the 7-day trial). Test 3 days vs. 7 days vs. 14 days later.
- **Win-back offers** (App Store Connect) for lapsed subscribers, and **promotional offers** for people about to churn.
- **Offer codes** for creators, partners, employers and Product Hunt.
- **Price increases:** depending on the size of the increase and the region, Apple may require existing subscribers to agree to it. Consider keeping current subscribers on their price.
- **US web checkout:** since 2025, the US storefront allows links to outside payment. It may lower fees, but it adds friction and engineering, and the legal and fee situation is still changing. Re-evaluate at scale, with current guidelines and legal advice.

---

## 11. Paywall A/B tests

### How to run tests without breaking "Data Not Collected"

1. **Product-ID price tests (no SDK).** Create extra products such as `unhook.pro.yearly.b` at $39.99, assign each install to variant A or B at random on the device (stored locally), and show that variant's products. Assignment is random 50/50, so compare purchases and proceeds per product ID in App Store Connect directly. This needs a small code change to `Store.ProductID`.
2. **Sequential tests (no SDK, weaker).** Run A for 2 weeks, then B for 2 weeks, and compare App Store Connect numbers. Seasons and press spikes muddy the result, so use this only for big expected effects.
3. **Opt-in analytics (§13).** This gives proper funnels (paywall views → trial starts), but changes the App Privacy label.

**Sample size reality:** detecting a 20% relative lift on a 5% conversion rate (5% → 6%) needs about **8,000 paywall views per variant** (two-sided, 95% confidence, 80% power). Don't run more than one paywall test at a time until you have that traffic, and don't call winners early.

### Test backlog (in priority order)

| # | Test | Hypothesis | Primary metric | Guardrails |
|---|---|---|---|---|
| 1 | **Paywall timing:** end of onboarding (after the projection) vs. after the first milestone celebration vs. only at limits | Asking after the first win converts better and costs less retention | Trials per install | D7 retention, rating |
| 2 | **Personal headline:** "Pro costs less than N days of [habit]" vs. a feature list | Personal money framing beats features | Trial start rate | Refund rate |
| 3 | **Trial timeline:** "Today: full access · Day 5: we'll remind you · Day 7: billed" plus a real local reminder on day 5, vs. no timeline | Trust raises trial starts more than it lowers conversion | Trial → paid, net of refunds | Refund rate, 1-star reviews |
| 4 | **Yearly price:** $29.99 vs. $39.99 (product-ID method) | Demand holds at $39.99 | Proceeds per install | Conversion |
| 5 | **Lifetime prominence:** equal option vs. secondary link | Lifetime captures people who'd never subscribe without cannibalizing yearly | Proceeds per install (12-month view) | Yearly share |
| 6 | **Default plan:** yearly vs. monthly pre-selected | Yearly default raises LTV | 12-month proceeds | Refunds |
| 7 | **Free tier:** 1 vs. 2 free habits | A more generous free tier improves retention and word of mouth enough to pay off | D30 retention and proceeds | Conversion |

**Non-negotiables on every variant:** a visible close button, clear price and renewal terms, Terms and Privacy links, no fake countdowns or fake discounts, and SOS reachable without paying.

---

## 12. Funnel KPIs and targets

Every value in the "Target" columns is **a goal we set, not an industry benchmark.** Compare against App Store Connect's peer-group benchmarks (conversion rate, D1/D7/D28 retention, proceeds per download, crash rate) once data comes in, and reset targets after 60 days of real data.

| Stage | Metric | Where to measure (no SDK / with §13 analytics) | **Target at launch** | **Target at scale** |
|---|---|---|---|---|
| Store | Product page conversion (downloads ÷ unique impressions) | App Store Connect → App Analytics | Above peer median | Top quartile of peer group |
| Activation | Install → onboarding complete | Opt-in analytics (or a TestFlight sample before launch) | **≥ 75%** | ≥ 85% |
| Activation | Turn on reminders in onboarding | Opt-in analytics | ≥ 50% | ≥ 60% |
| Engagement | Use SOS at least once in the first 7 days | Opt-in analytics | ≥ 25% | ≥ 35% |
| Retention | **D1** | App Analytics (opt-in sample) | **≥ 35%** | ≥ 45% |
| Retention | **D7** | App Analytics | **≥ 18%** | ≥ 25% |
| Retention | **D30** (Apple reports D28) | App Analytics | **≥ 8%** | ≥ 12% |
| Monetization | Install → trial start | Subscriptions dashboard ÷ downloads | **≥ 5%** | ≥ 8% |
| Monetization | **Trial → paid** | Subscriptions dashboard | **≥ 35%** | ≥ 45% |
| Monetization | Install → paying within 30 days (all plans) | Sales & Trends ÷ downloads | ≥ 2% | ≥ 3.5% |
| Monetization | Yearly renewal (year 1 → 2) | Subscriptions dashboard | ≥ 30% | ≥ 40% |
| Monetization | Refunds | Sales & Trends | < 5% of purchases | < 3% |
| Quality | **App Store rating** | App Store Connect | **≥ 4.6** | ≥ 4.8 |
| Quality | Crash-free sessions | Xcode Organizer / App Analytics | ≥ 99.5% | ≥ 99.8% |
| Virality | Installs from share links and creator campaigns | Campaign links and CPP reports | Track | ≥ 20% of installs |

**Payback rule for paid acquisition:** scale a channel only while cost per trial start ÷ trial-to-paid rate stays below about 70% of first-year net proceeds per payer. Re-check monthly.

**Change course when:**

- D30 stays under 5% for two months. Fix retention before buying installs.
- Trial-to-paid stays under 20%. The paywall promise and the product don't match, so fix the value or the free/Pro split.
- The rating falls under 4.3. Pause promotion and fix what reviewers say.

---

## 13. Privacy-friendly analytics recommendation

### Level 0: at launch (recommended)

Use only Apple's built-in tools. No SDK, no network calls, and **"Data Not Collected" stays true.**

- **App Store Connect App Analytics:** impressions, product page views, conversion, traffic sources, campaign links, Custom Product Page and PPO results, retention (D1/D7/D28), crashes, and peer-group benchmarks.
- **Sales & Trends** and the **Subscriptions** dashboard: trials, conversions, renewals, churn and refunds by product and storefront.
- **Apple Ads** reports: installs by keyword.
- **Xcode Organizer:** crashes, hangs, launch time, energy.
- **TestFlight feedback** plus a short, voluntary survey link in Settings, hosted on your site.

The limits: there's no in-app funnel, the data comes only from users who opted in to share analytics with developers, and reports lag by 1–2 days. That's enough until about Stage 2.

### Level 1: when you need funnel data (about 10k+ monthly active users)

Add **opt-in, anonymous, allowlisted** product analytics:

- **Ask clearly.** Add a Settings toggle ("Share anonymous usage counts to help improve Unhook"), explained in plain words. Opt-in keeps trust but gives a smaller sample, which is the right trade for this category.
- **Allowlist events:**
  - `onboarding_step_completed(step)`
  - `onboarding_completed`
  - `paywall_viewed(reason)`
  - `paywall_plan_selected(plan)`
  - `sos_started`
  - `sos_completed`
  - `milestone_celebrated(milestone)`
  - `share_tapped`
  - `coach_opened`
- **Never send:**
  - Which habit someone is quitting (porn, alcohol, gambling and cannabis are sensitive and may count as health data under GDPR and US state laws)
  - Reasons, notes, triggers, moods, costs or dates
  - Coach prompts or responses
  - Any free text
- **No persistent user ID.** Use a random install ID rotated monthly, or plain aggregate counters.
- **Tools to evaluate:** a privacy-focused analytics service with a Swift SDK and EU hosting (TelemetryDeck is a common choice for Apple apps), or self-hosted open-source analytics (PostHog self-hosted, Aptabase). Check each one's data processing terms.
- **Update before shipping:**
  - The App Privacy label (likely *Usage Data → Product Interaction, not linked to identity, used for Analytics*)
  - `PrivacyInfo.xcprivacy` (collected data types)
  - The privacy policy
  - Settings copy ("Unhook never sends your habits anywhere" stays true)
  - The engineering contract's "no network calls except StoreKit" rule (an owner decision, not an engineer's)

### Never

- Ad-tech SDKs that track people across apps
- The App Tracking Transparency prompt
- Device fingerprinting
- Selling or sharing data

For paid-ad measurement use **AdAttributionKit / SKAdNetwork**, Apple's privacy-preserving attribution that doesn't need the tracking prompt. Check the App Privacy implications for your setup before you ship it.

---

## 14. First 90 days at a glance

| Week | Focus |
|---|---|
| −6 to −4 | Landing page, privacy policy, App Store Connect setup, IAPs, featuring nomination, social accounts |
| −4 to −1 | TestFlight with 50–200 quitters, onboarding fixes, 30-video backlog, creator outreach, press kit |
| 0 | Manual release (Tuesday–Thursday), founder posts, community posts where allowed, Apple Ads test |
| 1–2 | Reply to every review, fix top issues, first 10 creator posts live |
| 3–4 | Product Hunt, first PR pitches, first PPO test (frame 1 or icon) |
| 5–8 | Rotate keywords, build Custom Product Pages per habit, scale creators that perform, start localization wave 2 |
| 9–12 | First paywall test (if traffic allows), first partnership conversations, plan the next seasonal push |

Budget for the first 90 days (rough): $3k–$15k across creators, Apple Ads and design, plus the founder's time. Spend more only after the Stage 1 gate is met.
