// Reusable report: stores audited more than once, with each audit's date,
// auditor, checklist points covered, and score%.
//
// Run from the github-dashboard folder:
//   node scripts/repeat-audits-report.js
//
// Reads directly from the raw CSV exports (Audits, Store Master, Audit Response)
// one level up, so it always reflects the latest data drop without needing the
// full dashboard build (scripts/build-data.js) to run first.
//
// Same audit-dedup rule as build-data.js: raw Audits.csv rows are grouped by
// storeId+date and only the latest submission (by startedAt/createdAt) is kept,
// so a same-day resubmission doesn't get counted as a second "audit". City comes
// from Store Master (authoritative), not the audit row's free-text storeLocation.
// "Points covered" = number of Audit Response rows for that auditId, i.e. how many
// checklist questions were actually answered (this varies by checklist version:
// 27/52/44 pts have all been used at different points in time).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// Google Sheets exports get a fresh auto-numbered suffix "(1)", "(2)", etc. every time
// they're re-downloaded, so resolve by folder + stable name prefix, picking the most
// recently modified match (same approach as build-data.js).
function resolveFile(dir, prefix) {
  const full = path.join(ROOT, dir);
  const matches = fs.readdirSync(full)
    .filter((f) => f.toLowerCase().endsWith('.csv') && f.startsWith(prefix))
    .map((f) => ({ f, mtime: fs.statSync(path.join(full, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!matches.length) {
    throw new Error(`No CSV starting with "${prefix}" found in "${dir}"`);
  }
  return path.join(full, matches[0].f);
}

const FILES = {
  audits: resolveFile('Audits', 'Pod Audit Tool - Audits'),
  storeMaster: resolveFile('Store master', 'Pod Audit Tool - Store Master'),
  auditResponse: resolveFile('Audit Response', 'Pod Audit Tool - Audit Responses'),
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadCSV(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = parseCSV(text).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  const header = rows[0];
  const idx = {};
  header.forEach((h, i) => { idx[h.trim()] = i; });
  return { idx, rows: rows.slice(1) };
}

function get(r, idx, col) {
  const i = idx[col];
  if (i === undefined) return '';
  return (r[i] || '').trim();
}

function dateOnly(s) {
  if (!s) return '';
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return s;
}

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function main() {
  const sm = loadCSV(FILES.storeMaster);
  const storeMeta = new Map();
  for (const r of sm.rows) {
    const storeId = get(r, sm.idx, 'Store_ID');
    const city = get(r, sm.idx, 'City');
    const storeName = get(r, sm.idx, 'Store_Name');
    if (storeId) storeMeta.set(storeId, { city, storeName });
  }

  const au = loadCSV(FILES.audits);
  const auditGroups = new Map();
  for (const r of au.rows) {
    const storeId = get(r, au.idx, 'storeId');
    const date = dateOnly(get(r, au.idx, 'auditDate'));
    if (!storeId || !date) continue;
    const key = storeId + '|' + date;
    if (!auditGroups.has(key)) auditGroups.set(key, []);
    auditGroups.get(key).push(r);
  }

  const audits = [];
  for (const group of auditGroups.values()) {
    let best = group[0], bestTime = -1;
    for (const r of group) {
      const t = toDate(get(r, au.idx, 'startedAt')) || toDate(get(r, au.idx, 'createdAt'));
      const ms = t ? t.getTime() : 0;
      if (ms >= bestTime) { bestTime = ms; best = r; }
    }
    const storeId = get(best, au.idx, 'storeId');
    const meta = storeMeta.get(storeId) || {};
    audits.push({
      id: get(best, au.idx, 'id'),
      date: dateOnly(get(best, au.idx, 'auditDate')),
      storeId,
      city: meta.city || get(best, au.idx, 'storeLocation') || 'Unknown',
      storeName: meta.storeName || '',
      scorePercent: get(best, au.idx, 'scorePercent'),
      auditorName: get(best, au.idx, 'username'),
      auditorEmail: get(best, au.idx, 'userEmail'),
    });
  }

  const ar = loadCSV(FILES.auditResponse);
  const pointsPerAudit = new Map();
  for (const r of ar.rows) {
    const auditId = get(r, ar.idx, 'auditId');
    if (!auditId) continue;
    pointsPerAudit.set(auditId, (pointsPerAudit.get(auditId) || 0) + 1);
  }

  const byStore = new Map();
  for (const a of audits) {
    if (!byStore.has(a.storeId)) byStore.set(a.storeId, []);
    byStore.get(a.storeId).push(a);
  }

  const repeated = [...byStore.entries()].filter(([, list]) => list.length > 1);
  repeated.sort((a, b) => b[1].length - a[1].length);

  console.log(`Total distinct stores audited: ${byStore.size}`);
  console.log(`Stores audited MORE THAN ONCE: ${repeated.length}`);

  // Plain CSV row per audit visit, saved as a normal file the user can double-click
  // and open directly in Excel -- the .js script itself is not meant to be opened,
  // it has to be run with `node` to produce this output.
  const csvRows = [['Store ID', 'Store Name', 'City', 'Times Audited', 'Audit Date', 'Auditor', 'Points Covered', 'Score %']];
  for (const [storeId, list] of repeated) {
    const sorted = list.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    sorted.forEach((a) => {
      const pts = pointsPerAudit.get(a.id);
      csvRows.push([storeId, sorted[0].storeName, sorted[0].city, sorted.length, a.date, a.auditorName, pts === undefined ? 'missing' : pts, a.scorePercent]);
    });
  }
  const csvText = csvRows.map((row) => row.map((cell) => {
    const s = String(cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const outPath = path.join(ROOT, 'Stores Audited More Than Once.csv');
  fs.writeFileSync(outPath, csvText, 'utf8');
  console.log(`\nSaved: ${outPath}`);
}

main();
