# Trip Expenses

Phone app for logging business-trip bills. It reads each bill photo, files it into the company
"Foreign Travel Expenses Statement" Google Sheet, and builds the statement and bills PDFs.

- **App (install on your phone):** https://manu4mohanan-jpg.github.io/trip-expenses/
- **Engine and data:** a Google Apps Script in the owner's Google account. Trips, bills, photos and PDFs live
  only in that account's Google Drive. This repository holds the screens only: no data and no keys.
- **Access:** every request needs the private app key, which is typed into the app once and kept on that phone.

## Files
- `index.html` – the whole app (screens and logic)
- `manifest.webmanifest`, `icons/` – install name and icons
- `sw.js` – lets the app open like an installed app (data is never cached)
- `apps-script/Code.gs` – copy of the server code that runs in Google Apps Script (reference)

## Android app
GitHub builds an installable APK on every push to `main` (**Actions → Build Android app**).
Download it from **Releases** on your phone and open it to install. New builds install over the old one.
- `capacitor.config.json`, `android/` – the Android shell (app ID `com.manu.tripexpenses`)
- `scripts/build-web.mjs` – copies `index.html` into the app, so the web and Android versions are the same screens
- `android/app/trip-expenses-test.keystore` – test signing key for this app only (a Play Store release needs its own private key)
