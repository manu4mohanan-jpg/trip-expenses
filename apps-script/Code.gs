/**
 * TRIP EXPENSES — real app (Google Apps Script web app)
 *
 *  Each trip  = a copy of your company template ("FOREIGN TRAVEL EXPENSES STATEMENT") in Drive
 *               "Trip Expenses/<TripID · name>", with two extra tabs:
 *                 Bill Log   – the app's master list (one row per bill, photo link)
 *                 Rate Proof – exchange rate, where it came from, and the screenshot
 *  Every save rebuilds the Expenses blocks (Hotel / Food / Other / Taxi-Train-Bus / Out of pocket)
 *  and the Summary from the Bill Log. Same columns and E×F / SUM calculations as the template;
 *  rows are added inside a block when it fills up.
 *  Global register = "Trips – Global Register" sheet, one row per trip.
 *
 *  Script properties:  GEMINI_API_KEY (bill reading) · GEMINI_MODEL (optional)
 *                      TEMPLATE_ID (optional, defaults below) · EMP_NAME / EMP_NO (set in the app)
 */

const TEMPLATE_ID_DEFAULT = '1W9GJYAj_oX5qPM0BoVFDn-dtWptXRgOXEBGg97q6V08';
const SECS = { Hotel: 'H', Food: 'F', Transport: 'T', Other: 'O' };
const PAYS = ['Card', 'Cash', 'Personal'];
const CUR_NAMES = { GBP: 'POUNDS', EUR: 'EUROS', USD: 'US DOLLARS', JPY: 'YEN', AED: 'DIRHAMS', SGD: 'SINGAPORE DOLLARS',
  CHF: 'SWISS FRANCS', AUD: 'AUSTRALIAN DOLLARS', CNY: 'YUAN', THB: 'BAHT', IDR: 'RUPIAH', MYR: 'RINGGIT', CAD: 'CANADIAN DOLLARS',
  KRW: 'WON', VND: 'DONG', SAR: 'RIYALS', QAR: 'RIYALS', NZD: 'NZ DOLLARS', SEK: 'KRONA', NOK: 'KRONE', DKK: 'KRONE' };

const LOG_H = ['Bill ID', 'Date', 'Time', 'Category', 'Vendor', 'Description', 'Payment', 'Currency', 'Amount',
  'Rate (INR)', 'Amount (INR)', 'Photo', 'Photo File ID', 'Thumb', 'Logged At'];

const REG_H = ['Trip ID', 'Trip Name', 'Country', 'Code', 'Cities', 'Start Date', 'End Date', 'Purpose', 'Currency',
  'Rate (INR)', 'Rate Source', 'Card Load', 'Cash Taken', 'Cash Rate', 'Card Returned', 'Cash Returned', 'Tickets by Company (INR)',
  'Hotel (INR)', 'Food (INR)', 'Transport (INR)', 'Other (INR)', 'Out of Pocket (INR)', 'Forex Card (INR)', 'Forex Cash (INR)',
  'Personal (INR)', 'Total (INR)', 'Bills', 'Status', 'Trip Sheet', 'Folder', 'Rate File ID', 'Last Bills PDF',
  'Last Statement PDF', 'Created', 'Card Statement File ID'];
const REG_KEY = { 'Trip ID': 'id', 'Trip Name': 'name', 'Country': 'country', 'Code': 'code', 'Cities': 'cities',
  'Start Date': 'start', 'End Date': 'end', 'Purpose': 'purpose', 'Currency': 'currency', 'Rate (INR)': 'rate',
  'Rate Source': 'rateSource', 'Card Load': 'cardLoad', 'Cash Taken': 'cashTaken', 'Cash Rate': 'cashRate',
  'Card Returned': 'cardReturned', 'Cash Returned': 'cashReturned', 'Tickets by Company (INR)': 'tickets',
  'Hotel (INR)': 'hotel', 'Food (INR)': 'food', 'Transport (INR)': 'transport', 'Other (INR)': 'other',
  'Out of Pocket (INR)': 'oop', 'Forex Card (INR)': 'card', 'Forex Cash (INR)': 'cash', 'Personal (INR)': 'personal',
  'Total (INR)': 'totalInr', 'Bills': 'billCount', 'Status': 'status', 'Trip Sheet': 'sheetUrl', 'Folder': 'folderUrl',
  'Rate File ID': 'rateFileId', 'Last Bills PDF': 'pdfUrl', 'Last Statement PDF': 'statementUrl', 'Created': 'createdAt', 'Card Statement File ID': 'stmtFileId' };
const NUM_KEYS = ['rate', 'cardLoad', 'cashTaken', 'cashRate', 'cardReturned', 'cashReturned', 'tickets', 'hotel', 'food',
  'transport', 'other', 'oop', 'card', 'cash', 'personal', 'totalInr', 'billCount', 'createdAt'];
const EDITABLE = ['name', 'country', 'code', 'cities', 'start', 'end', 'purpose', 'currency', 'rate', 'rateSource',
  'cardLoad', 'cashTaken', 'cashRate', 'cardReturned', 'cashReturned', 'tickets', 'status'];

/* ═════════════════════ web app ═════════════════════ */

const APP_URL = 'https://manu4mohanan-jpg.github.io/trip-expenses/';

/** The app lives on GitHub Pages now; this address only answers the app's API calls. */
function doGet() {
  return HtmlService.createHtmlOutput('<p style="font:16px system-ui;padding:24px">Trip Expenses runs at <a href="' + APP_URL + '" target="_top">' + APP_URL + '</a></p>')
    .setTitle('Trip Expenses');
}

const API_FNS = { getBoot: getBoot, saveProfile: saveProfile, getRate: getRate, getTrip: getTrip, createTrip: createTrip,
  updateTrip: updateTrip, deleteTrip: deleteTrip, readBill: readBill, saveBill: saveBill, deleteBill: deleteBill,
  getPhoto: getPhoto, exportStatement: exportStatement, generatePdf: generatePdf, uploadStatement: uploadStatement,
  getStatement: getStatement, addFromStatement: addFromStatement };

/** API for the phone app: POST {key, fn, args}. Every call must carry the private APP_KEY. */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const key = props_().getProperty('APP_KEY');
    if (!key || req.key !== key) out = { ok: false, code: 'bad_key', error: 'Wrong or missing app key.' };
    else if (!API_FNS[req.fn]) out = { ok: false, code: 'bad_fn', error: 'Unknown action.' };
    else out = { ok: true, result: API_FNS[req.fn].apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, code: 'error', error: String(err && err.message || err).replace(/^Exception: /, '') };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor (and again after updating) to grant permissions, create the folder + register, and show your app key. */
function setup() {
  const s = env_();
  DriveApp.getFileById(templateId_());
  UrlFetchApp.fetch('https://open.er-api.com/v6/latest/GBP', { muteHttpExceptions: true });
  DriveApp.getFileById(DocumentApp.create('permission check').getId()).setTrashed(true);
  let key = props_().getProperty('APP_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); props_().setProperty('APP_KEY', key); }
  Logger.log('Ready.\nFolder: ' + s.root.getUrl() + '\nGlobal register: ' + s.reg.getParent().getUrl() +
    '\n\nYOUR APP KEY (type it into the app once, keep it private):\n' + key);
}

/** Run this only if you think the key leaked: makes a new key; the app will ask for it again. */
function resetAppKey() {
  props_().deleteProperty('APP_KEY');
  setup();
}

function getBoot() {
  const s = env_();
  return { profile: profile_(), trips: listTrips_(), hasKey: !!props_().getProperty('GEMINI_API_KEY'),
    registerUrl: s.reg.getParent().getUrl(), folderUrl: s.root.getUrl() };
}

function saveProfile(p) {
  props_().setProperty('EMP_NAME', String(p.empName || '').trim());
  props_().setProperty('EMP_NO', String(p.empNo || '').trim());
  return profile_();
}

/** Exchange rate: INR per 1 unit of `cur`. With a past `date` (YYYY-MM-DD) it returns that day's rate. */
function getRate(cur, date) {
  cur = String(cur || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error('Unknown currency');
  const todayIso = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const past = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) && date < todayIso;
  if (cur === 'INR') return { rate: 1, source: 'INR', at: past ? date : todayIso, historical: past };
  const cache = CacheService.getScriptCache();
  const key = 'fx_' + cur + '_' + (past ? date : 'now');
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  let out = null;
  if (past) {
    try {   // ECB reference rates; weekends/holidays return the previous working day
      const r = UrlFetchApp.fetch('https://api.frankfurter.app/' + date + '?from=' + cur + '&to=INR', { muteHttpExceptions: true });
      const j = JSON.parse(r.getContentText());
      if (j.rates && j.rates.INR) out = { rate: round_(j.rates.INR, 3), source: 'frankfurter.app (ECB) rate of ' + j.date, at: j.date, historical: true };
    } catch (e) {}
    if (!out) throw new Error('No past rate found for ' + cur + ' on ' + date + '. Type it in.');
  } else {
    try {
      const r = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/' + cur, { muteHttpExceptions: true });
      const j = JSON.parse(r.getContentText());
      if (j.result === 'success' && j.rates && j.rates.INR) out = { rate: round_(j.rates.INR, 3), source: 'open.er-api.com', at: j.time_last_update_utc || now_(), historical: false };
    } catch (e) {}
    if (!out) {
      try {
        const r = UrlFetchApp.fetch('https://api.frankfurter.app/latest?from=' + cur + '&to=INR', { muteHttpExceptions: true });
        const j = JSON.parse(r.getContentText());
        if (j.rates && j.rates.INR) out = { rate: round_(j.rates.INR, 3), source: 'frankfurter.app (ECB)', at: j.date, historical: false };
      } catch (e) {}
    }
    if (!out) throw new Error('Could not fetch a live rate. Type it in.');
  }
  cache.put(key, JSON.stringify(out), past ? 21600 : 1800);
  return out;
}

/* ═════════════════════ trips ═════════════════════ */

function getTrip(id) {
  const t = tripRow_(id);
  const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
  return { trip: clean_(t), bills: readLog_(ss) };
}

function createTrip(d) {
  validate_(d);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const s = env_();
    const code = String(d.code || d.country || 'XXX').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'XXX';
    const start = d.start || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
    const base = 'TRP-' + start.slice(2).replace(/-/g, '') + '-' + code;
    const ids = listTrips_().map(x => x.id);
    let id = base, n = 2;
    while (ids.indexOf(id) >= 0) id = base + '-' + (n++);

    const folder = s.root.createFolder(id + ' · ' + d.name);
    folder.createFolder('Bills');
    const file = DriveApp.getFileById(templateId_()).makeCopy(id + ' · ' + d.name, folder);
    const ss = SpreadsheetApp.open(file);
    if (!ss.getSheetByName('Summary') || !ss.getSheetByName('Expenses')) throw new Error('Template needs "Summary" and "Expenses" tabs.');

    const log = ss.insertSheet('Bill Log');
    log.getRange(1, 1, 1, LOG_H.length).setValues([LOG_H]).setFontWeight('bold').setBackground('#1e7a58').setFontColor('#ffffff');
    log.setFrozenRows(1);
    log.getRange('B2:B').setNumberFormat('dd/mm/yyyy');
    log.getRange('C2:C').setNumberFormat('@');
    log.getRange('I2:I').setNumberFormat('#,##0.00');
    log.getRange('J2:J').setNumberFormat('0.000');
    log.getRange('K2:K').setNumberFormat('#,##0.00');
    log.getRange('O2:O').setNumberFormat('dd/mm/yyyy hh:mm');
    log.hideColumns(13, 2);
    log.setColumnWidth(1, 190); log.setColumnWidth(5, 180); log.setColumnWidth(6, 220);

    const trip = Object.assign({}, pick_(d), { id: id, code: code, start: start, status: d.status === 'Submitted' ? 'Submitted' : 'Active',
      sheetUrl: ss.getUrl(), folderUrl: folder.getUrl(), createdAt: Date.now() });
    if (d.rateShot) trip.rateFileId = folder.createFile(blob_(d.rateShot, id + '_RATE')).getId();
    writeRateProof_(ss, trip);
    s.reg.appendRow(REG_H.map(h => ''));
    writeTrip_(s.reg.getLastRow(), trip);
    render_(ss, trip, []);
    return { trip: clean_(tripRow_(id)), bills: [] };
  } finally { lock.releaseLock(); }
}

function updateTrip(id, d) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tripRow_(id);
    const m = Object.assign({}, t, pick_(d));
    validate_(m);
    const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
    if (d.rateShot) {
      if (t.rateFileId) try { DriveApp.getFileById(t.rateFileId).setTrashed(true); } catch (e) {}
      m.rateFileId = DriveApp.getFolderById(idFromUrl_(t.folderUrl)).createFile(blob_(d.rateShot, id + '_RATE')).getId();
    }
    // forex bills that used the old trip rate follow the new one
    if (Number(m.rate) !== Number(t.rate)) {
      const log = ss.getSheetByName('Bill Log'), n = log.getLastRow() - 1;
      if (n > 0) {
        const v = log.getRange(2, 7, n, 4).getValues();
        log.getRange(2, 10, n, 1).setValues(v.map(r => [(r[0] !== 'Personal' && r[1] === m.currency && Number(r[3]) === Number(t.rate)) ? Number(m.rate) : r[3]]));
      }
    }
    writeTrip_(t._row, m);
    if (d.rateShot || d.rate !== undefined || d.rateSource !== undefined) writeRateProof_(ss, m);
    const bills = readLog_(ss);
    render_(ss, m, bills);
    return { trip: clean_(tripRow_(id)), bills: bills };
  } finally { lock.releaseLock(); }
}

/** Moves the trip folder (sheet, photos, PDFs) to Drive's bin and removes it from the register. */
function deleteTrip(id) {
  const t = tripRow_(id);
  try { DriveApp.getFolderById(idFromUrl_(t.folderUrl)).setTrashed(true); } catch (e) {}
  env_().reg.deleteRow(t._row);
  return listTrips_();
}

/* ═════════════════════ bills ═════════════════════ */

function readBill(dataUrl, currency) {
  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'Bill reading is off (no GEMINI_API_KEY). Type the details.' };
  try {
    const m = String(dataUrl).match(/^data:(.+?);base64,(.*)$/);
    const model = props_().getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    const prompt = 'Read this photo of a bill or receipt from a business trip. The trip\'s local currency is ' + currency + '.\n' +
      'amount = FINAL total actually paid (incl. tax, service, tip). currency = ISO 4217, assume ' + currency + ' if none printed.\n' +
      'date YYYY-MM-DD, time HH:MM 24h or "". vendor = shop/company. description = max 8 words ("Dinner for 2", "Taxi airport to hotel").\n' +
      'category: Hotel (room, lodging) | Food (meals, drinks, groceries, cafés) | Transport (taxi, Uber, metro, train, bus, flight) | Other (fuel, parking, tolls, tickets, SIM, adapters, supplies).\n' +
      'payment: Card if card/VISA/Mastercard/contactless/auth code shown, Cash if cash/change shown, else Unknown. confidence for the amount.';
    const body = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT',
        properties: { date: { type: 'STRING' }, time: { type: 'STRING' }, vendor: { type: 'STRING' }, description: { type: 'STRING' },
          amount: { type: 'NUMBER' }, currency: { type: 'STRING' }, category: { type: 'STRING', enum: Object.keys(SECS) },
          payment: { type: 'STRING', enum: ['Card', 'Cash', 'Unknown'] }, confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] } },
        required: ['amount', 'currency', 'category'] } }
    };
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ok: false, error: 'Could not read the bill (' + res.getResponseCode() + '). Type the details.' };
    const j = JSON.parse(res.getContentText());
    const p = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
    const out = JSON.parse(p[0].text);
    out.ok = true;
    return out;
  } catch (e) { return { ok: false, error: 'Could not read the bill. Type the details.' }; }
}

/**
 * b = { editId?, date, time, category, payment, vendor, description, currency, amount, rate, inr?, photo?, thumb? }
 * Personal bills: inr = rupees actually charged → Out of pocket.
 */
function saveBill(tripId, b) {
  if (!(Number(b.amount) > 0)) throw new Error('Enter the amount');
  if (!b.date) throw new Error('Add the date');
  if (PAYS.indexOf(b.payment) < 0) throw new Error('Choose how you paid');
  if (!SECS[b.category]) throw new Error('Choose a section');
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const t = tripRow_(tripId);
    const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
    const log = ss.getSheetByName('Bill Log');
    const bills = readLog_(ss);
    const old = b.editId ? bills.find(x => x.id === b.editId) : null;
    const code = SECS[b.category];
    let id = old && old.id.slice(-4, -3) === code ? old.id : null;
    if (!id) {
      let max = 0;
      bills.forEach(x => { const mm = x.id.match(new RegExp('-' + code + '(\\d+)$')); if (mm) max = Math.max(max, +mm[1]); });
      id = tripId + '-' + code + ('00' + (max + 1)).slice(-3);
    }
    let fileId = old ? old.fileId : '', photoUrl = old ? old.photoUrl : '', thumb = old ? old.thumb : '';
    const billsFolder = sub_(DriveApp.getFolderById(idFromUrl_(t.folderUrl)), 'Bills');
    if (b.photo) {
      if (fileId) try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
      const f = billsFolder.createFile(blob_(b.photo, id));
      fileId = f.getId(); photoUrl = f.getUrl(); thumb = b.thumb || '';
    } else if (old && fileId && old.id !== id) {
      try { DriveApp.getFileById(fileId).setName(id + '.jpg'); } catch (e) {}
    }
    const amount = round_(b.amount, 2);
    const currency = String(b.currency || t.currency).toUpperCase();
    let rate = Number(b.rate);
    if (b.payment === 'Personal' && Number(b.inr) > 0) rate = Number(b.inr) / amount;
    if (!(rate > 0)) rate = currency === t.currency ? Number(t.rate) : (currency === 'INR' ? 1 : 0);
    if (!(rate > 0)) throw new Error('Enter the rate for ' + currency);

    let row = old ? old._row : log.getLastRow() + 1;
    log.getRange(row, 1, 1, LOG_H.length).setValues([[
      id, dateObj_(b.date), String(b.time || ''), b.category, String(b.vendor || '').trim(), String(b.description || '').trim(),
      b.payment, currency, amount, round_(rate, 5), '=ROUND(I' + row + '*J' + row + ',2)',
      photoUrl ? '=HYPERLINK("' + photoUrl + '","View bill")' : '', fileId, thumb, new Date()]]);
    const fresh = readLog_(ss);
    render_(ss, t, fresh);
    return { billId: id, trip: clean_(tripRow_(tripId)), bills: fresh };
  } finally { lock.releaseLock(); }
}

function deleteBill(tripId, billId) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const t = tripRow_(tripId);
    const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
    const b = readLog_(ss).find(x => x.id === billId);
    if (b) {
      if (b.fileId) try { DriveApp.getFileById(b.fileId).setTrashed(true); } catch (e) {}
      ss.getSheetByName('Bill Log').deleteRow(b._row);
    }
    const fresh = readLog_(ss);
    render_(ss, t, fresh);
    return { trip: clean_(tripRow_(tripId)), bills: fresh };
  } finally { lock.releaseLock(); }
}

/** Full-size photo for the edit screen. */
function getPhoto(fileId) {
  const b = DriveApp.getFileById(fileId).getBlob();
  return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/* ═════════════════════ forex card statement ═════════════════════ */

const STMT_H = ['Date', 'Description', 'Amount', 'Currency', 'Type', 'Section (suggested)'];

/** Saves the card statement PDF in the trip folder, reads its transactions, and returns the match against the bills. */
function uploadStatement(tripId, dataUrl) {
  const t = tripRow_(tripId);
  const folder = DriveApp.getFolderById(idFromUrl_(t.folderUrl));
  if (t.stmtFileId) try { DriveApp.getFileById(t.stmtFileId).setTrashed(true); } catch (e) {}
  const f = folder.createFile(blob_(dataUrl, tripId + '_CARD_STATEMENT'));
  regSet_(t._row, 'stmtFileId', f.getId());
  const parsed = parseStatement_(dataUrl, t.currency);
  writeStmt_(SpreadsheetApp.openById(idFromUrl_(t.sheetUrl)), parsed);
  return getStatement(tripId);
}

function parseStatement_(dataUrl, cur) {
  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Reading the statement needs GEMINI_API_KEY in Script properties.');
  const m = String(dataUrl).match(/^data:(.+?);base64,(.*)$/);
  const model = props_().getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const prompt = 'This is a prepaid forex card statement (e.g. Thomas Cook) for a business trip. The trip currency is ' + cur + '.\n' +
    'List EVERY transaction row. For each: date YYYY-MM-DD; description = merchant or narration as printed; amount = positive number in the card currency; ' +
    'currency = ISO code of that amount; type = purchase (card payment at a merchant, incl. online), atm (cash withdrawal), fee (bank/markup/ATM fee), load (money loaded or reloaded), refund (credit/reversal), other.\n' +
    'section = best guess for purchases: Hotel | Food | Transport (taxi, Uber, rail, metro, bus, flights) | Other.\n' +
    'Also give the opening and closing balance in the trip currency if printed (else 0).';
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: {
      openingBalance: { type: 'NUMBER' }, closingBalance: { type: 'NUMBER' },
      transactions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        date: { type: 'STRING' }, description: { type: 'STRING' }, amount: { type: 'NUMBER' }, currency: { type: 'STRING' },
        type: { type: 'STRING', enum: ['purchase', 'atm', 'fee', 'load', 'refund', 'other'] },
        section: { type: 'STRING', enum: Object.keys(SECS) } }, required: ['date', 'description', 'amount', 'type'] } } },
      required: ['transactions'] } }
  };
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Could not read the statement (' + res.getResponseCode() + ').');
  const j = JSON.parse(res.getContentText());
  const p = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  const out = JSON.parse(p[0].text);
  out.transactions = (out.transactions || []).map(x => ({ date: String(x.date || ''), description: String(x.description || '').trim(),
    amount: round_(Math.abs(Number(x.amount) || 0), 2), currency: String(x.currency || cur).toUpperCase(), type: x.type || 'other',
    section: SECS[x.section] ? x.section : 'Other' })).filter(x => x.amount > 0);
  return out;
}

function writeStmt_(ss, p) {
  let sh = ss.getSheetByName('Card Statement');
  if (!sh) sh = ss.insertSheet('Card Statement');
  sh.clear();
  sh.getRange('A1:B2').setValues([['FOREX CARD STATEMENT', ''], ['Opening balance', Number(p.openingBalance) || 0]]);
  sh.getRange('C2:D2').setValues([['Closing balance', Number(p.closingBalance) || 0]]);
  sh.getRange('A1').setFontWeight('bold').setFontSize(13);
  sh.getRange(4, 1, 1, STMT_H.length).setValues([STMT_H]).setFontWeight('bold').setBackground('#1e7a58').setFontColor('#ffffff');
  if (p.transactions.length) {
    sh.getRange(5, 1, p.transactions.length, STMT_H.length).setValues(p.transactions.map(x =>
      [dateObj_(x.date), x.description, x.amount, x.currency, x.type, x.section]));
    sh.getRange(5, 1, p.transactions.length, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(5, 3, p.transactions.length, 1).setNumberFormat('#,##0.00');
  }
  sh.setColumnWidth(2, 280);
}

function readStmt_(ss) {
  const sh = ss.getSheetByName('Card Statement');
  if (!sh) return null;
  const n = sh.getLastRow() - 4;
  const txns = n > 0 ? sh.getRange(5, 1, n, STMT_H.length).getValues().filter(r => r[1] !== '').map((r, i) => ({ i: i,
    date: isoDate_(r[0]), description: String(r[1]), amount: Number(r[2]) || 0, currency: String(r[3]), type: String(r[4]),
    section: SECS[r[5]] ? String(r[5]) : 'Other' })) : [];
  return { opening: Number(sh.getRange('B2').getValue()) || 0, closing: Number(sh.getRange('D2').getValue()) || 0, txns: txns };
}

/** Pairs card payments with Forex-card bills: same currency, amount within 2% (min 0.05), date within 3 days. */
function match_(txns, bills) {
  const pool = bills.filter(b => b.payment === 'Card').map(b => ({ b: b, used: false }));
  txns.forEach(x => {
    if (x.type !== 'purchase' && x.type !== 'fee') { x.status = 'info'; return; }
    let best = null, bs = 1e9;
    pool.forEach(p => {
      if (p.used || p.b.currency !== x.currency) return;
      const diff = Math.abs(p.b.amount - x.amount);
      if (diff > Math.max(0.05, x.amount * 0.02)) return;
      const dd = x.date && p.b.date ? Math.abs((dateObj_(p.b.date) - dateObj_(x.date)) / 864e5) : 0;
      if (dd > 3) return;
      const score = diff * 10 + dd;
      if (score < bs) { bs = score; best = p; }
    });
    if (best) { best.used = true; x.status = 'matched'; x.billId = best.b.id; x.billAmount = best.b.amount; }
    else x.status = 'nobill';
  });
  return pool.filter(p => !p.used).map(p => ({ id: p.b.id, vendor: p.b.vendor, date: p.b.date, amount: p.b.amount, currency: p.b.currency }));
}

function getStatement(tripId) {
  const t = tripRow_(tripId);
  const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
  const st = readStmt_(ss);
  if (!st) return { has: false };
  const notOnStatement = match_(st.txns, readLog_(ss));
  return { has: true, fileUrl: t.stmtFileId ? 'https://drive.google.com/file/d/' + t.stmtFileId + '/view' : '',
    opening: st.opening, closing: st.closing, txns: st.txns, notOnStatement: notOnStatement };
}

/** Adds chosen card payments as bills with no photo: "No bill available – as per card statement". items = [{i, category}] */
function addFromStatement(tripId, items) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const t = tripRow_(tripId);
    const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
    const st = readStmt_(ss);
    const log = ss.getSheetByName('Bill Log');
    const bills = readLog_(ss);
    const max = {}; bills.forEach(b => { const mm = b.id.match(/-([HFTO])(\d+)$/); if (mm) max[mm[1]] = Math.max(max[mm[1]] || 0, +mm[2]); });
    const rows = [];
    let row = log.getLastRow() + 1;
    items.forEach(it => {
      const x = st.txns.find(y => y.i === it.i); if (!x) return;
      const cat = SECS[it.category] ? it.category : x.section;
      const code = SECS[cat]; max[code] = (max[code] || 0) + 1;
      const id = tripId + '-' + code + ('00' + max[code]).slice(-3);
      let rate = x.currency === t.currency ? Number(t.rate) : (x.currency === 'INR' ? 1 : 0);
      if (!rate) { try { rate = getRate(x.currency, x.date).rate; } catch (e) { rate = Number(t.rate); } }
      rows.push([id, dateObj_(x.date), '', cat, x.description, 'No bill available – as per card statement', 'Card', x.currency,
        x.amount, round_(rate, 5), '=ROUND(I' + row + '*J' + row + ',2)', '', '', '', new Date()]);
      row++;
    });
    if (rows.length) log.getRange(log.getLastRow() + 1, 1, rows.length, LOG_H.length).setValues(rows);
    const fresh = readLog_(ss);
    render_(ss, t, fresh);
    return { trip: clean_(tripRow_(tripId)), bills: fresh, statement: getStatement(tripId) };
  } finally { lock.releaseLock(); }
}

/* ═════════════════════ PDFs ═════════════════════ */

/** Company statement: Summary + Expenses tabs as one PDF (landscape A4). */
function exportStatement(tripId) {
  const t = tripRow_(tripId);
  const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
  render_(ss, t, readLog_(ss));
  const hide = ['Bill Log', 'Rate Proof', 'Card Statement'].map(n => ss.getSheetByName(n)).filter(Boolean);
  hide.forEach(sh => sh.hideSheet());
  SpreadsheetApp.flush();
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&size=A4&portrait=false&fitw=true' +
      '&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED&fzr=false&horizontal_alignment=CENTER';
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Statement export failed (' + res.getResponseCode() + ')');
    const name = tripId + ' · Statement · ' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd-HHmm') + '.pdf';
    const f = DriveApp.getFolderById(idFromUrl_(t.folderUrl)).createFile(res.getBlob().setName(name));
    regSet_(t._row, 'statementUrl', f.getUrl());
    return { url: f.getUrl(), name: name };
  } finally { hide.forEach(sh => sh.showSheet()); }
}

/** Bills PDF. mode: all | Card | Cash | Personal */
function generatePdf(tripId, mode) {
  const t = tripRow_(tripId);
  const ss = SpreadsheetApp.openById(idFromUrl_(t.sheetUrl));
  const all = readLog_(ss);
  const bills = mode && mode !== 'all' ? all.filter(b => b.payment === mode) : all;
  if (!bills.length) throw new Error('No bills in this group');
  const p = profile_();
  const label = { all: 'All bills', Card: 'Forex card bills', Cash: 'Forex cash bills', Personal: 'Out-of-pocket bills' }[mode || 'all'];
  const sec = b => b.payment === 'Personal' ? 'Out of pocket' : (b.category === 'Transport' ? 'Taxi / Train / Bus' : b.category);
  const payL = k => ({ Card: 'Forex card', Cash: 'Forex cash', Personal: 'Personal' })[k] || k;

  const doc = DocumentApp.create(tripId + ' · ' + label);
  const body = doc.getBody();
  body.setPageWidth(595.28).setPageHeight(841.89).setMarginTop(36).setMarginBottom(36).setMarginLeft(40).setMarginRight(40);
  const H = DocumentApp.ParagraphHeading;
  body.getParagraphs()[0].setText('Bills — ' + t.name).setHeading(H.TITLE);
  kv_(body, [['Employee', (p.empName || '') + (p.empNo ? '  ·  ' + p.empNo : '')], ['Trip ID', t.id],
    ['Place of visit', t.country + (t.cities ? ' — ' + t.cities : '')], ['Dates', dot_(t.start) + ' - ' + dot_(t.end)],
    ['Exchange rate', '1 ' + t.currency + ' = ' + t.rate + ' INR'], ['Included', label + ' · ' + bills.length + ' bills']]);
  const g = {}; let tot = 0;
  bills.forEach(b => { const k = sec(b); g[k] = g[k] || { n: 0, inr: 0 }; g[k].n++; g[k].inr += b.inr; tot += b.inr; });
  body.appendParagraph('Totals').setHeading(H.HEADING2);
  const rows = [['Section', 'Bills', 'Amount (INR)']];
  ['Hotel', 'Food', 'Taxi / Train / Bus', 'Other', 'Out of pocket'].forEach(k => { if (g[k]) rows.push([k, String(g[k].n), fmt_(g[k].inr)]); });
  rows.push(['TOTAL', String(bills.length), fmt_(tot)]);
  grid_(body, rows, 10);
  body.appendParagraph('Bill index').setHeading(H.HEADING2);
  const idx = [['Bill ID', 'Date', 'Section', 'Place', 'Paid', 'Amount', 'INR']];
  bills.forEach(b => idx.push([b.id, dmy_(b.date), sec(b), b.vendor, payL(b.payment), b.currency + ' ' + fmt_(b.amount), fmt_(b.inr)]));
  grid_(body, idx, 8);
  if (t.rateFileId) {
    try {
      const blob = DriveApp.getFileById(t.rateFileId).getBlob();
      body.appendPageBreak();
      body.appendParagraph('Exchange rate at trip start').setHeading(H.HEADING1);
      body.appendParagraph('1 ' + t.currency + ' = ' + t.rate + ' INR' + (t.rateSource ? '  (' + t.rateSource + ')' : ''));
      img_(body, blob, 515, 620);
    } catch (e) {}
  }
  bills.forEach(b => {
    body.appendPageBreak();
    body.appendParagraph(b.id).setHeading(H.HEADING1);
    kv_(body, [['Date / time', dmy_(b.date) + (b.time ? '  ' + b.time : '')], ['Section', sec(b)], ['Place / vendor', b.vendor],
      ['Description', b.description], ['Paid by', payL(b.payment)], ['Amount', b.currency + ' ' + fmt_(b.amount)],
      ['INR', fmt_(b.inr) + '  (@ ' + b.rate + ')']]);
    if (b.fileId) { try { img_(body, DriveApp.getFileById(b.fileId).getBlob(), 515, 500); } catch (e) { body.appendParagraph('Photo could not be loaded.'); } }
    else body.appendParagraph(/^No bill available/.test(b.description) ? 'No bill available. This payment is shown on the forex card statement.' : 'No photo attached to this bill.');
  });
  doc.saveAndClose();
  const df = DriveApp.getFileById(doc.getId());
  const name = tripId + ' · ' + label + ' · ' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd-HHmm') + '.pdf';
  const pdf = DriveApp.getFolderById(idFromUrl_(t.folderUrl)).createFile(df.getAs('application/pdf').setName(name));
  df.setTrashed(true);
  regSet_(t._row, 'pdfUrl', pdf.getUrl());
  return { url: pdf.getUrl(), name: name, count: bills.length };
}

/* ═════════════════════ sheet rendering ═════════════════════ */

const TOT = 'TOTAL MENTIONED IN SUMMARY SHEET';

/** Finds the blocks in the Expenses tab (they move when rows are added). */
function layout_(sh) {
  const last = Math.max(sh.getLastRow(), 45);
  const A = sh.getRange(1, 1, last, 1).getDisplayValues().map(r => String(r[0]).trim().toUpperCase());
  const Q = sh.getRange(1, 17, last, 1).getDisplayValues().map(r => String(r[0]).trim().toUpperCase());
  const aTot = []; A.forEach((v, i) => { if (v === TOT) aTot.push(i + 1); });
  const qTot = Q.indexOf(TOT) + 1;
  const taxi = A.findIndex(v => v.indexOf('TAXI') === 0) + 1;
  if (aTot.length < 2 || !qTot || !taxi) throw new Error('Expenses tab layout not recognised. Is the template unchanged?');
  return { top: { first: 3, total: aTot[0] }, other: { first: 4, total: qTot }, bot: { first: taxi + 2, total: aTot[1] } };
}

/** Adds rows inside a block until it can hold `need` bills. */
function grow_(sh, first, total, need) {
  const cap = total - first;
  if (need > cap) sh.insertRowsBefore(total - 1, need - cap + 2);
}

function render_(ss, t, bills) {
  const sh = ss.getSheetByName('Expenses');
  const rate = Number(t.rate);
  const fx = k => bills.filter(b => b.payment !== 'Personal' && b.category === k);
  const g = { Hotel: fx('Hotel'), Food: fx('Food'), Other: fx('Other'), Transport: fx('Transport'), oop: bills.filter(b => b.payment === 'Personal') };

  // make room (other first: its rows also widen hotel/food, then top, then bottom)
  let L = layout_(sh);
  grow_(sh, L.other.first, L.other.total, g.Other.length); L = layout_(sh);
  grow_(sh, L.top.first, L.top.total, Math.max(g.Hotel.length, g.Food.length)); L = layout_(sh);
  grow_(sh, L.bot.first, L.bot.total, Math.max(g.Transport.length, g.oop.length)); L = layout_(sh);

  block_(sh, L.top.first, L.top.total, 1, g.Hotel, t, false, 'sum');
  block_(sh, L.top.first, L.top.total, 9, g.Food, t, false, 'sum');
  block_(sh, L.other.first, L.other.total, 17, g.Other, t, false, 'mul');
  block_(sh, L.bot.first, L.bot.total, 1, g.Transport, t, false, 'mul');
  block_(sh, L.bot.first, L.bot.total, 9, g.oop, t, true, 'mul');
  summary_(ss, t, {
    hotel: 'E' + L.top.total, hotelInr: 'G' + L.top.total, food: 'M' + L.top.total, foodInr: 'O' + L.top.total,
    other: 'U' + L.other.total, otherInr: 'W' + L.other.total, taxi: 'E' + L.bot.total, taxiInr: 'G' + L.bot.total,
    oop: 'M' + L.bot.total, oopInr: 'O' + L.bot.total });
  registerTotals_(t, bills);
  SpreadsheetApp.flush();
}

/** One block: SNO | DATE | PLACE | BILL NO | CURRENCY | CONV. RATE | INR, then the TOTAL row. */
function block_(sh, first, total, c0, list, t, oop, totStyle) {
  const n = total - first;
  const A = col_(c0 + 4), R = col_(c0 + 5), I = col_(c0 + 6);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = first + i, b = list[i];
    const inrF = '=' + A + r + '*' + R + r;
    if (!b) { rows.push([i + 1, '', '', '', '', oop ? 1 : '=Summary!$F$7', inrF]); continue; }
    let amt, place = b.vendor + (b.description ? ' – ' + b.description : '');
    if (oop) { amt = b.inr; if (b.currency !== 'INR') place += ' (' + b.currency + ' ' + fmt_(b.amount) + ')'; }
    else if (b.currency === t.currency) amt = b.amount;
    else { amt = round_(b.inr / Number(t.rate), 2); place += ' (' + b.currency + ' ' + fmt_(b.amount) + ')'; }
    const billNo = b.photoUrl ? '=HYPERLINK("' + b.photoUrl + '","' + b.id + '")' : b.id;
    rows.push([i + 1, dateObj_(b.date), place, billNo, amt, oop ? 1 : '=Summary!$F$7', inrF]);
  }
  if (n > 0) {
    sh.getRange(first, c0, n, 7).setValues(rows);
    sh.getRange(first, c0 + 1, n, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(first, c0 + 4, n + 1, 1).setNumberFormat('0.00');
    sh.getRange(first, c0 + 5, n + 1, 1).setNumberFormat('0.000');
    sh.getRange(first, c0 + 6, n + 1, 1).setNumberFormat('0.00');
  }
  const last = total - 1;
  sh.getRange(total, c0 + 4, 1, 3).setValues([[
    '=SUM(' + A + first + ':' + A + last + ')',
    oop ? 1 : '=Summary!$F$7',
    totStyle === 'sum' ? '=SUM(' + I + first + ':' + I + last + ')' : '=' + A + total + '*' + R + total]]);
}

/** Fills the template's Summary tab (cell positions follow the company template). */
function summary_(ss, t, ref) {
  const s = ss.getSheetByName('Summary');
  const p = profile_();
  const cashRate = Number(t.cashRate) || Number(t.rate);
  const nd = (t.start && t.end) ? Math.round((dateObj_(t.end) - dateObj_(t.start)) / 864e5) + 1 : '';
  const put = (a, v) => s.getRange(a).setValue(v);
  put('C4', p.empName); put('G4', p.empNo);
  put('C5', t.country + (t.cities ? ' – ' + t.cities : ''));
  put('C7', "'" + dot_(t.start) + ' - ' + dot_(t.end));
  put('D8', CUR_NAMES[t.currency] || t.currency);
  put('C9', nd ? nd + ' days' : '');
  put('F7', Number(t.rate)); put('F9', '=F7'); put('E7', '=C40+C41');
  put('E16', '=Expenses!' + ref.hotel); put('F16', '=F7'); put('G16', '=E16*F16');
  put('E19', '=Expenses!' + ref.food); put('F19', '=F7'); put('G19', '=E19*F19');
  put('E22', '=Expenses!' + ref.taxi); put('F22', '=F19'); put('G22', '=E22*F22');
  put('B25', '*'); put('E25', '=Expenses!' + ref.other); put('F25', '=F22'); put('G25', '=E25*F25');
  put('E29', '=Expenses!' + ref.oop); put('F29', 1); put('G29', '=E29*F29');
  ['H16', 'J14', 'G20', 'I31', 'H49:I51'].forEach(a => s.getRange(a).clearContent());
  put('G33', '=SUM(G15:G32)');
  put('G35', Number(t.tickets) || '');
  put('C40', Number(t.cardLoad) || 0); put('D40', '=F7');
  put('C41', Number(t.cashTaken) || 0); put('D41', cashRate);
  put('B43', 'TOTAL IMPREST'); put('G43', '=SUM(G40:G41)');
  put('D47', Number(t.cardReturned) || 0); put('E47', '=D40');
  put('D48', Number(t.cashReturned) || 0); put('E48', '=D41');
  put('G51', '=+G43-G33');
  put('G45', '=G51-SUM(F47:F48)');      // imprest − spent − currency returned (− = company owes you)
}

function writeRateProof_(ss, t) {
  let sh = ss.getSheetByName('Rate Proof');
  if (!sh) sh = ss.insertSheet('Rate Proof');
  sh.clear();
  sh.getImages().forEach(i => i.remove());
  sh.getRange('A1:A4').setValues([['EXCHANGE RATE AT TRIP START'], ['1 ' + t.currency + ' = ' + t.rate + ' INR'],
    ['Source: ' + (t.rateSource || 'entered by traveller')], ['Recorded ' + Utilities.formatDate(new Date(), tz_(), 'dd/MM/yyyy HH:mm')]]);
  sh.getRange('A1').setFontWeight('bold').setFontSize(13);
  sh.setColumnWidth(1, 440);
  if (t.rateFileId) {
    try {
      const f = DriveApp.getFileById(t.rateFileId);
      sh.getRange('A5').setFormula('=HYPERLINK("' + f.getUrl() + '","Open screenshot")');
      sh.insertImage(f.getBlob(), 1, 7);
    } catch (e) {}
  }
}

/* ═════════════════════ register & log ═════════════════════ */

function registerTotals_(t, bills) {
  const tt = { hotel: 0, food: 0, transport: 0, other: 0, oop: 0, card: 0, cash: 0, personal: 0, total: 0 };
  bills.forEach(b => {
    if (b.payment === 'Personal') tt.oop += b.inr; else tt[b.category.toLowerCase()] += b.inr;
    tt[b.payment.toLowerCase()] += b.inr; tt.total += b.inr;
  });
  const row = t._row || tripRow_(t.id)._row;
  const reg = env_().reg;
  const c = REG_H.indexOf('Hotel (INR)') + 1;
  reg.getRange(row, c, 1, 10).setValues([[round_(tt.hotel, 2), round_(tt.food, 2), round_(tt.transport, 2), round_(tt.other, 2),
    round_(tt.oop, 2), round_(tt.card, 2), round_(tt.cash, 2), round_(tt.personal, 2), round_(tt.total, 2), bills.length]]);
}

function readLog_(ss) {
  const log = ss.getSheetByName('Bill Log');
  const n = log.getLastRow() - 1;
  if (n < 1) return [];
  return log.getRange(2, 1, n, LOG_H.length).getValues().map((r, i) => {
    const amount = Number(r[8]) || 0, rate = Number(r[9]) || 0;
    const fileId = String(r[12] || '');
    return { _row: i + 2, id: String(r[0]), date: isoDate_(r[1]), time: String(r[2] || ''), category: SECS[r[3]] ? String(r[3]) : 'Other',
      vendor: String(r[4]), description: String(r[5]), payment: PAYS.indexOf(r[6]) >= 0 ? String(r[6]) : 'Card',
      currency: String(r[7]), amount: amount, rate: rate, inr: round_(amount * rate, 2), fileId: fileId,
      photoUrl: fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : '', thumb: String(r[13] || '') };
  }).filter(b => b.id);
}

function listTrips_() {
  const reg = env_().reg, n = reg.getLastRow() - 1;
  if (n < 1) return [];
  return reg.getRange(2, 1, n, REG_H.length).getValues().filter(r => r[0]).map((r, i) => clean_(rowObj_(r, i + 2)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function tripRow_(id) {
  const reg = env_().reg, n = reg.getLastRow() - 1;
  if (n < 1) throw new Error('Trip not found');
  const v = reg.getRange(2, 1, n, REG_H.length).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]) === id) return rowObj_(v[i], i + 2);
  throw new Error('Trip not found: ' + id);
}

function rowObj_(r, row) {
  const o = { _row: row };
  REG_H.forEach((h, i) => {
    const k = REG_KEY[h]; let v = r[i];
    if (v instanceof Date) v = Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
    o[k] = NUM_KEYS.indexOf(k) >= 0 ? (Number(v) || 0) : String(v == null ? '' : v);
  });
  o.status = o.status || 'Active';
  return o;
}

function writeTrip_(row, t) {
  const reg = env_().reg;
  reg.getRange(row, 1, 1, REG_H.length).setNumberFormats([REG_H.map(h => NUM_KEYS.indexOf(REG_KEY[h]) >= 0 ? '0.###' : '@')]);
  const cur = reg.getRange(row, 1, 1, REG_H.length).getValues()[0];
  reg.getRange(row, 1, 1, REG_H.length).setValues([REG_H.map((h, i) => {
    const k = REG_KEY[h];
    return t[k] !== undefined && t[k] !== null ? t[k] : cur[i];
  })]);
}

function regSet_(row, key, val) {
  const h = Object.keys(REG_KEY).find(x => REG_KEY[x] === key);
  env_().reg.getRange(row, REG_H.indexOf(h) + 1).setValue(val);
}

/* ═════════════════════ helpers ═════════════════════ */

let ENV_ = null;
function env_() {
  if (ENV_) return ENV_;
  const p = props_();
  let root = null, ss = null;
  try { root = p.getProperty('ROOT_FOLDER_ID') ? DriveApp.getFolderById(p.getProperty('ROOT_FOLDER_ID')) : null; } catch (e) {}
  if (!root || root.isTrashed()) { root = DriveApp.createFolder('Trip Expenses'); p.setProperty('ROOT_FOLDER_ID', root.getId()); }
  try { ss = p.getProperty('REGISTER_ID') ? SpreadsheetApp.openById(p.getProperty('REGISTER_ID')) : null; } catch (e) {}
  if (!ss) {
    ss = SpreadsheetApp.create('Trips – Global Register');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    const sh = ss.getSheets()[0];
    sh.setName('Trips');
    sh.getRange(1, 1, 1, REG_H.length).setValues([REG_H]).setFontWeight('bold').setBackground('#1e7a58').setFontColor('#ffffff').setWrap(true);
    sh.setFrozenRows(1);
    p.setProperty('REGISTER_ID', ss.getId());
  }
  const regSh = ss.getSheetByName('Trips');
  if (regSh.getLastColumn() < REG_H.length) regSh.getRange(1, 1, 1, REG_H.length).setValues([REG_H]).setFontWeight('bold').setBackground('#1e7a58').setFontColor('#ffffff');
  ENV_ = { root: root, reg: regSh };
  return ENV_;
}

function props_() { return PropertiesService.getScriptProperties(); }
function profile_() { return { empName: props_().getProperty('EMP_NAME') || '', empNo: props_().getProperty('EMP_NO') || '' }; }
function templateId_() { return props_().getProperty('TEMPLATE_ID') || TEMPLATE_ID_DEFAULT; }
function tz_() { return Session.getScriptTimeZone(); }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'dd MMM yyyy HH:mm'); }
function round_(n, d) { const f = Math.pow(10, d); return Math.round((Number(n) || 0) * f) / f; }
function fmt_(n) { return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dot_(iso) { return iso ? String(iso).split('-').reverse().join('.') : ''; }
function dmy_(iso) { return iso ? String(iso).split('-').reverse().join('/') : ''; }
function dateObj_(iso) { const p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function isoDate_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : String(v || ''); }
function col_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function clean_(t) { const o = Object.assign({}, t); delete o._row; return o; }
function pick_(d) { const o = {}; EDITABLE.forEach(k => { if (d[k] !== undefined) o[k] = NUM_KEYS.indexOf(k) >= 0 ? (Number(d[k]) || 0) : String(d[k]); }); if (o.currency) o.currency = o.currency.toUpperCase(); return o; }
function validate_(t) { if (!t.name || !t.country || !/^[A-Z]{3}$/.test(String(t.currency).toUpperCase()) || !(Number(t.rate) > 0)) throw new Error('Add trip name, country, currency and rate'); }
function idFromUrl_(u) { const m = String(u).match(/[-\w]{25,}/); if (!m) throw new Error('Bad Drive link'); return m[0]; }
function sub_(folder, name) { const it = folder.getFoldersByName(name); return it.hasNext() ? it.next() : folder.createFolder(name); }
function blob_(dataUrl, name) {
  const m = String(dataUrl).match(/^data:(.+?);base64,(.*)$/);
  if (!m) throw new Error('Bad image data');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name + '.' + m[1].split('/')[1].replace('jpeg', 'jpg'));
}
function img_(body, blob, maxW, maxH) {
  const im = body.appendImage(blob);
  const s = Math.min(maxW / im.getWidth(), maxH / im.getHeight(), 1);
  im.setWidth(Math.round(im.getWidth() * s)).setHeight(Math.round(im.getHeight() * s));
  im.getParent().asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
}
function kv_(body, rows) {
  const t = body.appendTable(rows.map(r => [String(r[0]), String(r[1] == null ? '' : r[1])]));
  t.setBorderWidth(0.5).setBorderColor('#d0d0d0'); t.editAsText().setFontSize(10);
  for (let i = 0; i < t.getNumRows(); i++) { const c = t.getRow(i).getCell(0); c.setBackgroundColor('#eef6f2').setWidth(120); c.editAsText().setBold(true); }
}
function grid_(body, rows, size) {
  const t = body.appendTable(rows.map(r => r.map(x => String(x == null ? '' : x))));
  t.setBorderWidth(0.5).setBorderColor('#d0d0d0'); t.editAsText().setFontSize(size || 10);
  const h = t.getRow(0);
  for (let i = 0; i < h.getNumCells(); i++) { h.getCell(i).setBackgroundColor('#1e7a58'); h.getCell(i).editAsText().setBold(true).setForegroundColor('#ffffff'); }
}
