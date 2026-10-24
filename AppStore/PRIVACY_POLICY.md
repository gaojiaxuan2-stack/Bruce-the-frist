# Privacy policy template

App Store Connect needs a public **Privacy Policy URL** for every app, even one that collects nothing. This is a starting point that matches what Unhook actually does (see the App Privacy answers in [APP_REVIEW_NOTES.md](APP_REVIEW_NOTES.md)).

**How to use it**

1. Replace every `REPLACE_ME_…` value.
2. Host it as a plain web page, for example `https://<your-domain>/privacy`.
3. Put that URL in `metadata/en-US/privacy_url.txt`, in the description's "Privacy Policy:" line and in App Store Connect's *Privacy Policy URL* field. Guideline 3.1.2 also requires a privacy policy inside the app: the paywall's *Privacy Policy* button already opens an in-app copy (`PrivacyPolicyView`), so keep the two saying the same thing.
4. Update it **before** you ship anything that changes what data leaves the device.
5. Keep it consistent with the in-app policy (`Unhook/Views/Paywall/PrivacyPolicyView.swift`) and with the App Privacy answers. When this kit was written the in-app copy didn't yet mention the coach, widgets or data export by name, so add short lines for them there (or remove them here if a feature doesn't ship).
6. Before publishing, check that **Settings → Erase all data** really removes everything listed below, savings goals included. When this kit was written it deleted habits, slips, cravings and pledges but not savings goals; the integrator was asked to fix that.

> This template isn't legal advice. If you add analytics, accounts, community features or a backend, or if you sell to employers or insurers, have a lawyer review the policy. GDPR, UK GDPR, CCPA/CPRA and US state health-data laws such as Washington's My Health My Data Act can apply.

---

## Unhook Privacy Policy

*Last updated: REPLACE_ME_DATE*

Unhook ("the app") is made by REPLACE_ME_LEGAL_NAME ("we"). We built Unhook so you can work on sensitive habits without giving that information to anyone, including us.

### The short version

- We don't collect, store or sell your personal data.
- You don't need an account.
- Your habits, streaks, notes, moods, cravings and goals stay on your device.
- There are no ads, no analytics and no tracking.

### Information stored on your device

Unhook stores what you enter: habit names, quit dates, costs, reasons, slips, cravings and their triggers, notes, daily pledges and moods, and savings goals. This information is saved on your device only. We can't see it.

If you delete the app, or use **Settings → Erase all data**, this information is removed from your device. Device backups you make (for example iCloud Backup) follow Apple's backup settings and are controlled by you and Apple.

### Purchases

Unhook Pro is sold through Apple's App Store. Apple processes your payment. We receive only the information Apple provides to every developer about a purchase (for example, that a subscription is active). We don't receive your name, email address or payment details. See Apple's privacy policy at https://www.apple.com/legal/privacy/.

### The coach

Coach replies are generated on your device, either by Apple's on-device model (on devices with Apple Intelligence) or by a built-in script. What you type into the coach and what it replies are not sent to us or to any third-party AI service, and the conversation isn't saved after you close it.

### Widgets, Siri and Shortcuts

Unhook's widgets read your streak from a storage area on your device that only the Unhook app and its widgets can open. If you use Unhook with Siri or the Shortcuts app, Apple processes your request under Apple's privacy policy. Unhook receives only the action you asked for, such as opening SOS, and the result stays on your device.

### Face ID

If you turn on the app lock, your device tells Unhook only whether authentication succeeded. Unhook never receives your face or fingerprint data.

### Exporting your data

When you export your data, Unhook creates a file on your device. You choose where to share or save it through your device's share sheet. We don't receive a copy.

### Notifications

Reminders and milestone alerts are scheduled on your device. We don't run a notification server.

### Crash reports

If you choose to share analytics with app developers in your device settings, Apple may share anonymous crash and performance reports with us. You can turn this off in **Settings → Privacy & Security → Analytics & Improvements**.

### Children

Unhook isn't directed at children under 13 and doesn't knowingly collect information from anyone, including children.

### Changes to this policy

If we ever change how Unhook handles data, we'll update this page and the "Last updated" date, and describe the change in the app's release notes before it takes effect.

### Contact

Questions about privacy: REPLACE_ME_CONTACT_EMAIL

REPLACE_ME_POSTAL_ADDRESS (include it if you're registered as a trader in the EU, or if your local law requires it)
