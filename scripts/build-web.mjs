// Builds www/ for the Android app from the same index.html used on GitHub Pages (one source of truth).
// The app version skips the service worker: Android already keeps the app on the phone.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';

let html = readFileSync('index.html', 'utf8');
html = html.replace("if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});", '');
html = html.replace('<html lang="en">', '<html lang="en" class="apk">');
mkdirSync('www', { recursive: true });
writeFileSync('www/index.html', html);
cpSync('icons', 'www/icons', { recursive: true });
cpSync('manifest.webmanifest', 'www/manifest.webmanifest');
console.log('www/ built from index.html');
