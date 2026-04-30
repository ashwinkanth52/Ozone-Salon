/**
 * Ozone Salon & Spa — ERP Backend (Google Apps Script Web App)
 * ============================================================
 * Acts as REST API between PWA frontend and Google Sheets database.
 *
 * Deployment:
 *   1. Open Google Sheet (or create new) → Extensions → Apps Script
 *   2. Paste this file as Code.gs (replace any existing)
 *   3. Deploy → New deployment → Type: Web app
 *      • Execute as:        Me
 *      • Who has access:    Anyone
 *   4. Copy deployment URL → paste into PWA setup wizard
 *
 * The app sends a SECRET key generated on first setup; it is stored
 * in the Config tab and validated on every write call. Treat the
 * deployment URL as semi-sensitive.
 */

/* ========== CONFIG / CONSTANTS ========== */
const TABS = {
  CONFIG:        'Config',
  STAFF:         'Staff',
  SERVICES:      'Services',
  TRANSACTIONS:  'Transactions',
  EXPENSES:      'Expenses',
  FIXED:         'FixedExpenses',
  SALARIES:      'Salaries',
  EMI:           'EMI',
  ATTENDANCE:    'Attendance',
  FOOTFALL:      'Footfall',
};

const HEADERS = {
  Config:        ['key','value'],
  Staff:         ['id','name','salary'],
  Services:      ['category','name','price'],
  Transactions:  ['id','date','time','services','subtotal','discount','discountLabel','gst','total','paymentMethod','staffName'],
  Expenses:      ['id','date','category','description','amount'],
  FixedExpenses: ['id','name','amount'],
  Salaries:      ['id','staffId','staffName','month','year','amount','paidDate'],
  EMI:           ['id','name','totalAmount','monthlyEMI','startDate','monthsPaid'],
  Attendance:    ['id','date','staffName','checkIn'],
  Footfall:      ['date','count'],
};

/* ========== ENTRY POINTS ========== */
function doGet(e)  { return route_(e); }
function doPost(e) { return route_(e); }

function route_(e) {
  try {
    const p      = (e && e.parameter) || {};
    const action = p.action || 'ping';

    if (action === 'ping')             return ok_({ msg: 'Ozone backend live ✓', time: new Date().toISOString() });
    if (action === 'getAll')           return ok_(handleGetAll_());
    if (action === 'getDashboard')     return ok_(handleGetDashboard_(p.month));
    if (action === 'getTransactions')  return ok_({ transactions: getRowsForMonth_(TABS.TRANSACTIONS, p.month) });
    if (action === 'getExpenses')      return ok_({ expenses:     getRowsForMonth_(TABS.EXPENSES,     p.month) });
    if (action === 'getSalaries')      return ok_({ salaries:     readTab_(TABS.SALARIES) });

    if (action === 'write') {
      const payloadRaw = p.payload || '';
      const payload    = JSON.parse(decodeURIComponent(payloadRaw));
      return ok_(handleWrite_(payload, p.key));
    }

    return err_('Unknown action: ' + action);
  } catch (err) {
    return err_(String(err && err.stack || err));
  }
}

/* ========== WRITE DISPATCHER ========== */
function handleWrite_(payload, providedKey) {
  const sub = payload.action;

  // First-time setup — accept without key, store the new secret
  if (sub === 'setup') {
    return doSetup_(payload);
  }

  // All other writes require valid secret key
  const stored = getConfigValue_('secretKey');
  if (stored && providedKey !== stored) {
    throw new Error('Invalid secret key');
  }

  if (sub === 'logAttendance')      return logAttendance_(payload.row);
  if (sub === 'updateFootfall')     return upsertFootfall_(payload.date, payload.count);
  if (sub === 'logTransaction')     return appendRow_(TABS.TRANSACTIONS, payload.row);
  if (sub === 'logExpense')         return appendRow_(TABS.EXPENSES, payload.row);
  if (sub === 'logSalary')          return appendRow_(TABS.SALARIES, payload.row);
  if (sub === 'saveFixedExpenses')  return replaceTab_(TABS.FIXED, payload.expenses);
  if (sub === 'saveEMI')            return replaceTab_(TABS.EMI, payload.emi);
  if (sub === 'markEMIPaid')        return markEMIPaid_(payload.emiId);
  if (sub === 'saveStaff')          return replaceTab_(TABS.STAFF, payload.staff);
  if (sub === 'saveServices')       return replaceTab_(TABS.SERVICES, payload.services);
  if (sub === 'saveConfig')         return saveConfig_(payload.config);

  throw new Error('Unknown write sub-action: ' + sub);
}

/* ========== SETUP / FIRST RUN ========== */
function doSetup_(payload) {
  ensureAllTabs_();
  if (payload.config) {
    saveConfig_(payload.config); // includes secretKey
  }
  if (payload.services && payload.services.length) {
    replaceTab_(TABS.SERVICES, payload.services);
  }
  if (payload.staff && payload.staff.length) {
    replaceTab_(TABS.STAFF, payload.staff);
  }
  if (payload.fixedExpenses && payload.fixedExpenses.length) {
    replaceTab_(TABS.FIXED, payload.fixedExpenses);
  }
  if (payload.emi && payload.emi.length) {
    replaceTab_(TABS.EMI, payload.emi);
  }
  return { setup: true };
}

/* ========== READS ========== */
function handleGetAll_() {
  ensureAllTabs_();
  const configRows = readTab_(TABS.CONFIG);
  const config = {};
  configRows.forEach(r => { if (r.key) config[r.key] = r.value; });
  return {
    config:         config,
    staff:          readTab_(TABS.STAFF),
    services:       readTab_(TABS.SERVICES),
    fixedExpenses:  readTab_(TABS.FIXED),
    emi:            readTab_(TABS.EMI),
  };
}

function handleGetDashboard_(month) {
  // month format: YYYY-MM
  if (!month) month = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM');

  const txs       = getRowsForMonth_(TABS.TRANSACTIONS, month);
  const variable  = getRowsForMonth_(TABS.EXPENSES,     month);
  const fixed     = readTab_(TABS.FIXED);
  const salaries  = readTab_(TABS.SALARIES);
  const emi       = readTab_(TABS.EMI);
  const footfalls = readTab_(TABS.FOOTFALL).filter(r => String(r.date || '').startsWith(month));

  const sum = (arr, key) => arr.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0);

  const revenue     = sum(txs, 'total');
  const varExpenses = sum(variable, 'amount');
  const fixedTotal  = sum(fixed, 'amount');
  const [yy, mm]    = month.split('-');
  const salaryTotal = salaries
    .filter(s => String(s.month) === mm && String(s.year) === yy)
    .reduce((a, s) => a + (parseFloat(s.amount) || 0), 0);
  const emiTotal    = sum(emi, 'monthlyEMI'); // monthly outflow projection
  const totalExpenses = varExpenses + fixedTotal + salaryTotal + emiTotal;
  const netPL       = revenue - totalExpenses;
  const footfall    = footfalls.reduce((s, r) => s + (parseInt(r.count) || 0), 0);

  return {
    revenue, varExpenses, fixedTotal, salaryTotal, emiTotal,
    totalExpenses, netPL, txCount: txs.length, footfall,
  };
}

/* ========== TAB I/O HELPERS ========== */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureAllTabs_() {
  Object.keys(HEADERS).forEach(name => ensureTab_(name, HEADERS[name]));
}

function ensureTab_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#FAF6F0');
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#FAF6F0');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readTab_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const range  = sh.getDataRange().getValues();
  const header = range[0];
  return range.slice(1)
    .filter(row => row.some(c => c !== '' && c !== null))
    .map(row => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function appendRow_(tabName, rowObj) {
  const sh = ensureTab_(tabName, HEADERS[tabName]);
  const headers = HEADERS[tabName];
  const row = headers.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
  sh.appendRow(row);
  return { appended: 1, tab: tabName };
}

function replaceTab_(tabName, rows) {
  const sh = ensureTab_(tabName, HEADERS[tabName]);
  const headers = HEADERS[tabName];
  // Clear data rows (keep header)
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
  if (!rows || !rows.length) return { written: 0, tab: tabName };
  const matrix = rows.map(r => headers.map(h => r[h] !== undefined ? r[h] : ''));
  sh.getRange(2, 1, matrix.length, headers.length).setValues(matrix);
  return { written: matrix.length, tab: tabName };
}

function getRowsForMonth_(tabName, month) {
  if (!month) return readTab_(tabName);
  return readTab_(tabName).filter(r => String(r.date || '').startsWith(month));
}

/* ========== CONFIG (key/value tab) ========== */
function getConfigValue_(key) {
  const rows = readTab_(TABS.CONFIG);
  const found = rows.find(r => r.key === key);
  return found ? found.value : '';
}

function saveConfig_(partial) {
  const sh = ensureTab_(TABS.CONFIG, HEADERS.Config);
  const existing = readTab_(TABS.CONFIG);
  const map = {};
  existing.forEach(r => { if (r.key) map[r.key] = r.value; });
  Object.keys(partial || {}).forEach(k => {
    if (partial[k] !== undefined && partial[k] !== null) map[k] = partial[k];
  });
  // Rewrite whole config tab
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  }
  const out = Object.keys(map).map(k => [k, map[k]]);
  if (out.length) sh.getRange(2, 1, out.length, 2).setValues(out);
  return { configKeys: Object.keys(map).length };
}

/* ========== ATTENDANCE / FOOTFALL ========== */
function logAttendance_(row) {
  // De-dupe per (date, staffName) — overwrite if exists
  const sh = ensureTab_(TABS.ATTENDANCE, HEADERS.Attendance);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idxDate = headers.indexOf('date');
  const idxName = headers.indexOf('staffName');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxDate]) === String(row.date) &&
        String(data[i][idxName]) === String(row.staffName)) {
      // Update checkIn
      const idxCI = headers.indexOf('checkIn');
      sh.getRange(i + 1, idxCI + 1).setValue(row.checkIn);
      return { updated: 1 };
    }
  }
  return appendRow_(TABS.ATTENDANCE, row);
}

function upsertFootfall_(date, count) {
  const sh = ensureTab_(TABS.FOOTFALL, HEADERS.Footfall);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(date)) {
      sh.getRange(i + 1, 2).setValue(count);
      return { updated: 1, date: date };
    }
  }
  sh.appendRow([date, count]);
  return { appended: 1, date: date };
}

/* ========== EMI ========== */
function markEMIPaid_(emiId) {
  const sh = ensureTab_(TABS.EMI, HEADERS.EMI);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idxId   = headers.indexOf('id');
  const idxPaid = headers.indexOf('monthsPaid');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(emiId)) {
      const cur = parseInt(data[i][idxPaid]) || 0;
      sh.getRange(i + 1, idxPaid + 1).setValue(cur + 1);
      return { emiId: emiId, monthsPaid: cur + 1 };
    }
  }
  throw new Error('EMI not found: ' + emiId);
}

/* ========== RESPONSE WRAPPERS ========== */
function ok_(extra) {
  const body = Object.assign({ ok: true }, extra || {});
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
function err_(message) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(message) }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ========== ONE-CLICK INIT (run from Apps Script editor) ========== */
function initialize() {
  ensureAllTabs_();
  Logger.log('All tabs created. Ready for first-time setup from PWA.');
}
