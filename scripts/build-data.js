// Builds data/dashboard-data.json from the raw Pod Audit Tool CSV exports.
// Run: node scripts/build-data.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..'); // "Audit tracking - CAPA closures"
const OUT_JS = path.join(__dirname, '..', 'data', 'dashboard-data.js');

// Google Sheets exports get a fresh auto-numbered suffix "(1)", "(2)", etc. every time
// they're re-downloaded, and exports are sometimes partial (e.g. a day-slice instead of the
// full history), so no single file is guaranteed complete. We therefore merge EVERY CSV
// matching the folder + name prefix and drop exact-duplicate rows; the per-entity dedup
// downstream (store+date+auditor for audits, auditId+questionNo for CAPA, keptAuditIds gate)
// collapses overlapping history safely.
function loadMergedCSV(dir, prefix) {
  const full = path.join(ROOT, dir);
  const matches = fs.readdirSync(full)
    .filter((f) => f.toLowerCase().endsWith('.csv') && f.startsWith(prefix))
    .sort();
  if (!matches.length) {
    throw new Error(`No CSV starting with "${prefix}" found in "${dir}"`);
  }
  let headers = null;
  const seen = new Set();
  const rows = [];
  let skippedDupeRows = 0;
  for (const f of matches) {
    const { headers: h, rows: rs } = loadCSV(path.join(full, f));
    if (!headers) headers = h;
    else if (h.join('\u0000') !== headers.join('\u0000')) {
      throw new Error(`Header mismatch in ${dir}/${f} vs first file ${matches[0]}`);
    }
    for (const r of rs) {
      const key = r.join('\u0000');
      if (seen.has(key)) { skippedDupeRows++; continue; }
      seen.add(key);
      rows.push(r);
    }
  }
  const idx = {};
  headers.forEach((hh, i) => (idx[hh] = i));
  return { headers, idx, rows, skippedDupeRows };
}

const FILES = {
  storeMaster: { dir: 'Store master', prefix: 'Pod Audit Tool - Store Master' },
  audits: { dir: 'Audits', prefix: 'Pod Audit Tool - Audits' },
  capa: { dir: 'Capa Tasks', prefix: 'Pod Audit Tool - CAPA Tasks' },
  responses: { dir: 'Audit Response', prefix: 'Pod Audit Tool - Audit Responses' },
  sku: { dir: 'Audit SKU wise', prefix: 'Pod Audit Tool - Audit Sku Checks' },
  zoneVerify: { dir: 'Zone verify check', prefix: 'Pod Audit Tool - Audit Zone Verify Checks' },
  expiryItems: { dir: 'expiry check items', prefix: 'Pod Audit Tool - Expiry Check Items' },
  clusterDetails: { dir: 'Cluster details', prefix: 'Daily Review-redline - WTD' },
  // Deliberately not deep-processed:
  //  - "Audit Response wide" is the same data as `responses`, just pivoted wide (one row per
  //    audit, one column per checkpoint). We already get everything from the long format.
  //  - "Audit Logs" is app-usage telemetry (session_start/page_view/submit_* events), not
  //    audit findings — it has no compliance/CAPA content to report on.
};

const FILE = FILES; // loadMerged(FILE.x) shorthand at call sites

function loadMerged(def) {
  return loadMergedCSV(def.dir, def.prefix);
}

// ---------- CSV parsing (RFC4180-ish, handles quoted commas/newlines) ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadCSV(filePath) {
  // Some Google Sheets exports prepend a UTF-8 BOM, which would otherwise glue
  // itself onto the first header name ("﻿id") and break every column lookup.
  const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const rows = parseCSV(text);
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => (idx[h] = i));
  const dataRows = rows.slice(1).filter((r) => r.length === headers.length && r.some((x) => x !== ''));
  return { headers, idx, rows: dataRows };
}

function get(row, idx, col) {
  const i = idx[col];
  return i === undefined ? '' : (row[i] || '').trim();
}

// ---------- date helpers (all source dates are ISO: YYYY-MM-DD or full ISO timestamp) ----------
function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function dateOnly(s) {
  if (!s) return null;
  return s.slice(0, 10);
}
function isoWeekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - day + 1); // back to Monday
  const monday = d.toISOString().slice(0, 10);
  const sunday = new Date(d.getTime() + 6 * 86400000).toISOString().slice(0, 10);
  return { key: monday, label: `${monday.slice(5)} to ${sunday.slice(5)}`, start: monday, end: sunday };
}
function monthLabel(dateStr) {
  const [y, m] = dateStr.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return { key: `${y}-${m}`, label: `${names[parseInt(m, 10) - 1]} ${y}` };
}

// ---------- parameter -> business metric mapping ----------
// Derived from Audit Response's `parameter` column. The two headline checks the
// business asks about ("expiry removals" and "FnV damage removal") are, in the
// source data, the SAME checkpoint ("Check for presence of Rotten/Spoiled/damaged,
// expired products") tagged parameter = 'Expiry-Removal' across every zone — so we
// surface it as one combined metric rather than inventing a split that isn't in the data.
const PARAM_META = {
  'Expiry-Removal':  { label: 'Expiry & Damage Removal (Rotten/Spoiled/Expired SKUs)', short: 'Expiry & Damage', icon: 'trash', group: 'headline' },
  'Chiller-Temp':    { label: 'Chiller Temperature Compliance',  short: 'Chiller Temp',  icon: 'chiller', group: 'headline' },
  'Freezer-Temp':    { label: 'Freezer Temperature Compliance',  short: 'Freezer Temp',  icon: 'freezer', group: 'headline' },
  'AC Room-Temp':    { label: 'AC Room Temperature Compliance',  short: 'AC Room Temp',  icon: 'acroom',  group: 'headline' },
  'Inward-Temp':     { label: 'Inward Temperature Compliance',   short: 'Inward Temp',   icon: 'inward',  group: 'headline' },
  'FIFO/FEFO-Stacking':       { label: 'FIFO/FEFO Stacking Accuracy', short: 'FIFO/FEFO', icon: 'stack', group: 'other' },
  'Puffed packs-Removal':     { label: 'Puffed / Damaged Pack Removal', short: 'Puffed Packs', icon: 'trash', group: 'other' },
  'Storage Location Adherence': { label: 'Storage Location Adherence', short: 'Storage Location', icon: 'location', group: 'other' },
  'Zone temp':       { label: 'Zone Temperature (Ambient)', short: 'Zone Temp', icon: 'thermo', group: 'other' },
  'Stacking':        { label: 'Overloading / Stacking Check', short: 'Stacking', icon: 'stack', group: 'other' },
  'QC-Record':       { label: 'Quality Check Record', short: 'QC Record', icon: 'clipboard', group: 'other' },
  'Put Away':        { label: 'Put-Away Compliance', short: 'Put Away', icon: 'box', group: 'other' },
  'Remarks':         { label: 'Other Observations', short: 'Other', icon: 'note', group: 'other' },
};
const HEADLINE_ORDER = ['Expiry-Removal', 'Chiller-Temp', 'Freezer-Temp', 'AC Room-Temp', 'Inward-Temp'];

// ---------- category normalization ----------
// The real business grouping in this data is FNV / Noice / DBEM (Dairy, Bread, Eggs
// & Meat) / Other Brands. Audit Response has TWO columns that each carry half the
// picture: `brand` (Fruits & Vegetables / Noice / Other brand(s), several spellings)
// and `category` (FNV / Dairy / Bread / Eggs / Fresh & Frozen Meat / "DBE&Meats" /
// "Ice Cream/Frozen Food" / "Dairy/Meats" / "Bread/ Eggs" / "Other Brands" / etc).
// Neither column alone is complete — a chunk of Dairy/Bread/Eggs/Meat rows ship with
// a BLANK brand column, and get silently dropped if you only key off `brand`. Cross-
// tabulating brand x category (36,836 response rows) reconciles perfectly into 4
// buckets + one legitimately-excluded zone-header slice, so this mapping is verified
// against every row, not guessed:
//   FNV          7,568  (brand=Fruits & Vegetables/Nectr & Other FNV, OR category=FNV with blank brand)
//   Noice       18,094  (brand=Noice — already covers its Dairy/Ice-cream/Munchies/Bread-Eggs sub-categories)
//   DBEM        10,310  (brand=Other brand(s) EXCEPT category=Other Brands, OR blank-brand rows tagged
//                         category Dairy/Bread/Eggs/Fresh & Frozen Meat)
//   Other Brands    49  (brand=Other Brands AND category=Other Brands)
//   (dropped)      815  ('Put Away'/'All Zones Articles' zone-summary rows, not attributable to one category)
// Total: 7568+18094+10310+49+815 = 36,836 — matches the source file exactly.
function normalizeCategory(rawBrand, rawCategory) {
  const b = (rawBrand || '').trim();
  const c = (rawCategory || '').trim();
  if (b === 'Fruits & Vegetables' || b === 'Nectr & Other FNV') return 'FNV';
  if (c === 'FNV') return 'FNV';
  if (b === 'Noice') return 'Noice';
  if (b === 'Other brand' || b === 'Other brands' || b === 'Other Brands') return c === 'Other Brands' ? 'Other Brands' : 'DBEM';
  if (c === 'Dairy' || c === 'Bread' || c === 'Eggs' || c === 'Fresh & Frozen Meat') return 'DBEM';
  return null;
}
const CATEGORY_NAMES = ['FNV', 'Noice', 'DBEM', 'Other Brands'];

// ---------- cluster mapping ----------
// The "Cluster details" export keys on Pod ID (same format as Store Master's
// Store_ID) and has a City column too. Store Master spells a few cities
// differently than the Cluster file does — these are the only 3 mismatches
// found by cross-checking every city name in both files.
const CLUSTER_CITY_ALIASES = {
  'Bhathinda': 'Bathinda',
  'Bhubaneshwar': 'Bhubaneswar',
  'Trivandrum': 'Thiruvananthapuram',
};
function loadClusterMaps() {
  const cd = loadMerged(FILE.clusterDetails);
  const clusterByPodId = new Map();
  const clusterByCity = new Map();
  for (const r of cd.rows) {
    const podId = get(r, cd.idx, 'Pod ID');
    const city = get(r, cd.idx, 'City');
    const cluster = get(r, cd.idx, 'Cluster');
    if (!cluster) continue;
    if (podId) clusterByPodId.set(podId, cluster);
    if (city && !clusterByCity.has(city)) clusterByCity.set(city, cluster);
  }
  function resolveCluster(storeId, city) {
    if (storeId && clusterByPodId.has(storeId)) return clusterByPodId.get(storeId);
    if (city) {
      if (clusterByCity.has(city)) return clusterByCity.get(city);
      const alias = CLUSTER_CITY_ALIASES[city];
      if (alias && clusterByCity.has(alias)) return clusterByCity.get(alias);
    }
    return 'Unmapped';
  }
  return { clusterByPodId, clusterByCity, resolveCluster };
}

function main() {
  console.log('Loading Cluster details...');
  const { resolveCluster } = loadClusterMaps();

  console.log('Loading Store Master...');
  const sm = loadMerged(FILE.storeMaster);
  const storeMeta = new Map(); // storeId -> {city, storeName, cluster}
  const cityTotals = new Map(); // city -> total store count
  const clusterByCityResolved = new Map(); // city -> cluster (for byCity rollups)
  for (const r of sm.rows) {
    const storeId = get(r, sm.idx, 'Store_ID');
    const city = get(r, sm.idx, 'City');
    const storeName = get(r, sm.idx, 'Store_Name');
    if (!storeId) continue;
    const cluster = resolveCluster(storeId, city);
    storeMeta.set(storeId, { city, storeName, cluster });
    cityTotals.set(city, (cityTotals.get(city) || 0) + 1);
    if (!clusterByCityResolved.has(city)) clusterByCityResolved.set(city, cluster);
  }
  let unmappedStoreCount = 0;
  for (const v of storeMeta.values()) if (v.cluster === 'Unmapped') unmappedStoreCount++;
  console.log(`  ${sm.rows.length} stores, ${unmappedStoreCount} unmapped to a cluster`);

  console.log('Loading Audits...');
  const au = loadMerged(FILE.audits);
  // One audit per store per date per auditor: multiple submissions by the same
  // auditor for the same store+day are resubmissions, not separate audits.
  // (Different auditors auditing the same store on the same day ARE kept.)
  const auditGroups = new Map(); // storeId|date|userEmail -> [rows]
  for (const r of au.rows) {
    const storeId = get(r, au.idx, 'storeId');
    const date = dateOnly(get(r, au.idx, 'auditDate'));
    const auditor = get(r, au.idx, 'userEmail').toLowerCase();
    if (!storeId || !date || !auditor) continue;
    const key = storeId + '|' + date + '|' + auditor;
    if (!auditGroups.has(key)) auditGroups.set(key, []);
    auditGroups.get(key).push(r);
  }
  const audits = []; // deduped canonical audits
  for (const [key, group] of auditGroups) {
    let best = group[0], bestTime = -1;
    for (const r of group) {
      const t = toDate(get(r, au.idx, 'startedAt')) || toDate(get(r, au.idx, 'createdAt'));
      const ms = t ? t.getTime() : 0;
      if (ms >= bestTime) { bestTime = ms; best = r; }
    }
    const storeId = get(best, au.idx, 'storeId');
    // Store Master's city is authoritative; a per-audit-row storeLocation typo (e.g. an
    // auditor picking the wrong city from a dropdown) must never override it, or the same
    // store ends up double-counted as "audited" under two different cities.
    const city = (storeMeta.get(storeId) || {}).city || get(best, au.idx, 'storeLocation') || 'Unknown';
    const meta = storeMeta.get(storeId) || {};
    audits.push({
      id: get(best, au.idx, 'id'),
      date: dateOnly(get(best, au.idx, 'auditDate')),
      storeId,
      city,
      cluster: meta.cluster || resolveCluster(storeId, city),
      storeName: meta.storeName || get(best, au.idx, 'storeLocation'),
      scorePercent: parseFloat(get(best, au.idx, 'scorePercent')) || 0,
      nc: parseInt(get(best, au.idx, 'nonCompliantCount'), 10) || 0,
      pc: parseInt(get(best, au.idx, 'partialCount'), 10) || 0,
      na: parseInt(get(best, au.idx, 'naCount'), 10) || 0,
      capaMailStatus: get(best, au.idx, 'capaMailStatus') || 'blank',
      resubmissions: group.length - 1,
    });
  }
  audits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // The Audits.csv export is sometimes a stale/partial slice (e.g. the 2026-10-08 11:01
  // export was missing 94 audits first submitted on Oct 7 and 42 on Oct 8, all present in
  // the fresher Audit Responses export). Rebuild those missing audits from the responses
  // file so daily counts don't silently under-report. date = first submission day (UTC),
  // which matches the auditDate the tool itself assigns on same-day submission; score
  // rollup uses the per-question `score` column (max 2 per scored question, same basis
  // as scorePercent).
  console.log('Synthesizing audits missing from Audits.csv (from Audit Responses)...');
  const arSrc = loadMerged(FILE.responses);
  const respAgg = new Map(); // auditId -> rollup
  for (const r of arSrc.rows) {
    const aid = get(r, arSrc.idx, 'auditId');
    if (!aid) continue;
    if (!respAgg.has(aid)) respAgg.set(aid, {
      username: get(r, arSrc.idx, 'username'),
      storeId: get(r, arSrc.idx, 'storeId'),
      storeLocation: get(r, arSrc.idx, 'storeLocation'),
      firstCreated: get(r, arSrc.idx, 'createdAt'),
      score: 0, maxScore: 0, nc: 0, pc: 0, na: 0,
    });
    const v = respAgg.get(aid);
    const created = get(r, arSrc.idx, 'createdAt');
    if (created && created < v.firstCreated) v.firstCreated = created;
    const score = parseFloat(get(r, arSrc.idx, 'score'));
    if (!isNaN(score)) { v.score += score; v.maxScore += 2; }
    const response = get(r, arSrc.idx, 'response');
    if (response === 'Non Compliance') v.nc++;
    else if (response === 'Partially Complied') v.pc++;
    else if (response && response !== 'Compliance') v.na++;
  }
  const auditedIds = new Set(audits.map((a) => a.id));
  // Collapse resubmissions among recovered audits too: same store+day+auditor = one visit.
  // Response rows only carry the auditor's display name, which can't be matched to the
  // Audits.csv email key reliably — so skip any recovered id whose auditId exists in
  // the raw Audits.csv (it's a superseded resubmission of a kept visit).
  const rawAuditIds = new Set(au.rows.map((r) => get(r, au.idx, 'id')).filter(Boolean));
  const recoveredByKey = new Map(); // storeId|date|auditor -> best synthesized audit
  let synthesized = 0;
  let synthesizedRaw = 0;
  for (const [aid, v] of respAgg) {
    if (auditedIds.has(aid) || rawAuditIds.has(aid)) continue;
    const date = dateOnly(v.firstCreated);
    if (!date || !v.storeId || !v.username) continue;
    const key = v.storeId + '|' + date + '|' + v.username.toLowerCase();
    synthesizedRaw++;
    const prev = recoveredByKey.get(key);
    if (!prev || v.firstCreated < prev.firstCreated) recoveredByKey.set(key, { aid, ...v, date });
  }
  for (const { aid, ...v } of recoveredByKey.values()) {
    const storeMetaS = storeMeta.get(v.storeId) || {};
    const city = storeMetaS.city || v.storeLocation || 'Unknown';
    audits.push({
      id: aid,
      date: v.date,
      storeId: v.storeId,
      city,
      cluster: storeMetaS.cluster || resolveCluster(v.storeId, v.city || city),
      storeName: storeMetaS.storeName || v.storeLocation || 'Unknown',
      scorePercent: v.maxScore ? Math.round((v.score / v.maxScore) * 1000) / 10 : 0,
      nc: v.nc, pc: v.pc, na: v.na,
      capaMailStatus: 'blank',
      resubmissions: 0,
      synthesized: true,
    });
    synthesized++;
  }
  if (synthesized) console.log(`  + ${synthesized} audits recovered from Audit Responses (${synthesizedRaw} raw missing rows -> deduped by store+day+auditor)`);

  audits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const maxDate = audits.reduce((m, a) => (a.date > m ? a.date : m), audits[0] ? audits[0].date : '');
  const NOW = new Date(maxDate + 'T23:59:59Z');
  console.log(`  ${au.rows.length} raw rows -> ${audits.length} deduped audits, data as of ${maxDate}`);
  // Every downstream file (Audit Response, CAPA Tasks, SKU-wise, Zone Verify) carries
  // its own auditId pointing back to one row in Audits.csv. When a POD resubmits an
  // audit for the same store+day, the superseded submission's auditId is dropped here
  // but its findings/CAPA tasks/SKU checks live on in those other files unless we also
  // gate them on this same kept-id set — otherwise they silently double-count.
  const keptAuditIds = new Set(audits.map((a) => a.id));

  // CAPA Tasks has no `brand` column of its own, only a messy free-text `category`
  // column that (like the original Audit Response bug) can't be told apart between
  // Noice and DBEM by text alone — e.g. "Dairy/Meats" shows up under both. Every CAPA
  // task traces back to one Audit Response row (same auditId+questionNo), which DOES
  // have brand+category, so join on that key and reuse normalizeCategory() instead of
  // trusting the CAPA sheet's own category text. Covers 6,361 of 6,375 tasks (99.8%);
  // the rest fall back to null (folded into "Other Brands" in the CAPA UI).
  console.log('Loading Audit Responses (for CAPA category join)...');
  const arForCapaJoin = loadMerged(FILE.responses);
  const capaCategoryByAuditQ = new Map();
  for (const r of arForCapaJoin.rows) {
    const key = get(r, arForCapaJoin.idx, 'auditId') + '|' + get(r, arForCapaJoin.idx, 'questionNo');
    capaCategoryByAuditQ.set(key, normalizeCategory(get(r, arForCapaJoin.idx, 'brand'), get(r, arForCapaJoin.idx, 'category')));
  }

  console.log('Loading CAPA Tasks...');
  const ct = loadMerged(FILE.capa);
  const capa = [];
  let capaSkippedDupe = 0;
  const idx_ct_created = ct.idx['createdAt'];
  const capaGroupKeys = new Map(); // auditId|questionNo -> best row (keep latest createdAt)
  for (const r of ct.rows) {
    const capaAuditId = get(r, ct.idx, 'auditId');
    if (!keptAuditIds.has(capaAuditId)) { capaSkippedDupe++; continue; }
    const groupKey = capaAuditId + '|' + get(r, ct.idx, 'questionNo');
    const prev = capaGroupKeys.get(groupKey);
    if (!prev) { capaGroupKeys.set(groupKey, r); continue; }
    const prevCreated = prev[idx_ct_created] || '';
    const thisCreated = get(r, ct.idx, 'createdAt');
    if (thisCreated >= prevCreated) capaGroupKeys.set(groupKey, r); else capaSkippedDupe++;
  }
  for (const r of capaGroupKeys.values()) {
    const capaAuditId = get(r, ct.idx, 'auditId');
    const storeId = get(r, ct.idx, 'storeId');
    const city = (storeMeta.get(storeId) || {}).city || get(r, ct.idx, 'storeLocation') || 'Unknown';
    const status = get(r, ct.idx, 'status') || 'Open';
    const createdAt = get(r, ct.idx, 'createdAt');
    const capaQuestionNo = get(r, ct.idx, 'questionNo');
    const category = capaCategoryByAuditQ.get(capaAuditId + '|' + capaQuestionNo) || null;
    const dueAt = get(r, ct.idx, 'dueAt');
    const closedAt = get(r, ct.idx, 'closedAt');
    const dueDate = toDate(dueAt);
    const closedDate = toDate(closedAt);
    let slaState;
    if (status === 'Closed') {
      slaState = (closedDate && dueDate && closedDate.getTime() > dueDate.getTime()) ? 'closed_late' : 'closed_on_time';
    } else {
      const overdue = dueDate ? NOW.getTime() > dueDate.getTime() : false;
      slaState = overdue ? (status === 'In Progress' ? 'in_progress_overdue' : 'open_overdue') : (status === 'In Progress' ? 'in_progress_on_track' : 'open_on_track');
    }
    let overdueDays = 0;
    if (slaState.includes('overdue') && dueDate) overdueDays = Math.max(1, Math.ceil((NOW.getTime() - dueDate.getTime()) / 86400000));
    if (slaState === 'closed_late' && dueDate && closedDate) overdueDays = Math.max(1, Math.ceil((closedDate.getTime() - dueDate.getTime()) / 86400000));
    const meta = storeMeta.get(storeId) || {};
    capa.push({
      capaId: get(r, ct.idx, 'capaId'),
      auditId: capaAuditId,
      storeId, city,
      cluster: meta.cluster || resolveCluster(storeId, city),
      storeName: meta.storeName || city,
      zone: get(r, ct.idx, 'zone'),
      category,
      checkpoint: get(r, ct.idx, 'checkpoint'),
      remark: get(r, ct.idx, 'remark'),
      response: get(r, ct.idx, 'response'),
      auditorName: get(r, ct.idx, 'auditorName'),
      assignedPodEmail: get(r, ct.idx, 'assignedPodEmail'),
      status, slaState, overdueDays,
      auditDate: dateOnly(get(r, ct.idx, 'auditDate')),
      createdAt, dueAt, closedAt,
      closedBy: get(r, ct.idx, 'closedBy'),
      closureRemark: get(r, ct.idx, 'closureRemark'),
      photoUrls: get(r, ct.idx, 'photoUrls'),
      closurePhotoUrls: get(r, ct.idx, 'closurePhotoUrls'),
    });
  }
  const capaStatusCounts = { Open: 0, 'In Progress': 0, Closed: 0 };
  const capaSlaCounts = { closed_on_time: 0, closed_late: 0, open_on_track: 0, open_overdue: 0, in_progress_on_track: 0, in_progress_overdue: 0 };
  for (const c of capa) { capaStatusCounts[c.status] = (capaStatusCounts[c.status] || 0) + 1; capaSlaCounts[c.slaState]++; }
  console.log(`  ${capa.length} CAPA tasks (${capaSkippedDupe} skipped: superseded resubmissions + duplicate auditId/questionNo rows):`, capaStatusCounts, capaSlaCounts);

  console.log('Loading Audit Responses (category/parameter compliance)...');
  const ar = loadMerged(FILE.responses);
  const paramStats = new Map(); // paramKey -> {compliant,nonCompliant,partial,na,byCity:Map,byPod:Map}
  const drilldown = new Map(); // paramKey -> [] noncompliant/partial records
  function ensureParam(key) {
    if (!paramStats.has(key)) paramStats.set(key, { compliant: 0, nonCompliant: 0, partial: 0, na: 0, byCity: new Map(), byPod: new Map() });
    return paramStats.get(key);
  }
  const brandParamStats = new Map(); // "Brand|paramKey" -> same shape as paramStats
  const categoryDrilldown = new Map(); // "Brand|paramKey" -> [] noncompliant/partial records
  function ensureBrandParam(key) {
    if (!brandParamStats.has(key)) brandParamStats.set(key, { compliant: 0, nonCompliant: 0, partial: 0, na: 0, byCity: new Map(), byPod: new Map() });
    return brandParamStats.get(key);
  }
  let arSkippedDupe = 0;
  for (const r of ar.rows) {
    if (!keptAuditIds.has(get(r, ar.idx, 'auditId'))) { arSkippedDupe++; continue; }
    const param = get(r, ar.idx, 'parameter');
    if (!param || !PARAM_META[param]) continue; // skip blank/unmapped rows
    const response = get(r, ar.idx, 'response');
    const storeId = get(r, ar.idx, 'storeId');
    const city = (storeMeta.get(storeId) || {}).city || get(r, ar.idx, 'storeLocation') || 'Unknown';
    const meta = storeMeta.get(storeId) || {};
    const storeName = meta.storeName || get(r, ar.idx, 'storeName') || city;
    const stat = ensureParam(param);
    if (response === 'Compliance') stat.compliant++;
    else if (response === 'Non Compliance') stat.nonCompliant++;
    else if (response === 'Partially Complied') stat.partial++;
    else stat.na++;

    const cityCluster = meta.cluster || resolveCluster(storeId, city);
    if (!stat.byCity.has(city)) stat.byCity.set(city, { total: 0, nc: 0, partial: 0, cluster: cityCluster });
    const cc = stat.byCity.get(city); cc.total++;
    if (response === 'Non Compliance') cc.nc++;
    if (response === 'Partially Complied') cc.partial++;

    const podKey = storeId || storeName;
    if (!stat.byPod.has(podKey)) stat.byPod.set(podKey, { storeId, storeName, city, cluster: cityCluster, total: 0, nc: 0, partial: 0 });
    const pp = stat.byPod.get(podKey); pp.total++;
    if (response === 'Non Compliance') pp.nc++;
    if (response === 'Partially Complied') pp.partial++;

    if (response === 'Non Compliance' || response === 'Partially Complied') {
      if (!drilldown.has(param)) drilldown.set(param, []);
      drilldown.get(param).push({
        city, storeId, storeName,
        auditDate: dateOnly(get(r, ar.idx, 'auditDate')),
        zone: get(r, ar.idx, 'zone'),
        checkpoint: get(r, ar.idx, 'checkpoint'),
        response,
        remark: get(r, ar.idx, 'remark'),
        photoUrls: get(r, ar.idx, 'photoUrls'),
        temperatureDegree: get(r, ar.idx, 'temperatureDegree'),
      });
    }

    const brandName = normalizeCategory(get(r, ar.idx, 'brand'), get(r, ar.idx, 'category'));
    if (brandName) {
      const bKey = brandName + '|' + param;
      const bstat = ensureBrandParam(bKey);
      if (response === 'Compliance') bstat.compliant++;
      else if (response === 'Non Compliance') bstat.nonCompliant++;
      else if (response === 'Partially Complied') bstat.partial++;
      else bstat.na++;

      if (!bstat.byCity.has(city)) bstat.byCity.set(city, { total: 0, nc: 0, partial: 0, cluster: cityCluster });
      const bcc = bstat.byCity.get(city); bcc.total++;
      if (response === 'Non Compliance') bcc.nc++;
      if (response === 'Partially Complied') bcc.partial++;

      const bPodKey = storeId || storeName;
      if (!bstat.byPod.has(bPodKey)) bstat.byPod.set(bPodKey, { storeId, storeName, city, cluster: cityCluster, total: 0, nc: 0, partial: 0 });
      const bpp = bstat.byPod.get(bPodKey); bpp.total++;
      if (response === 'Non Compliance') bpp.nc++;
      if (response === 'Partially Complied') bpp.partial++;

      if (response === 'Non Compliance' || response === 'Partially Complied') {
        if (!categoryDrilldown.has(bKey)) categoryDrilldown.set(bKey, []);
        categoryDrilldown.get(bKey).push({
          city, storeId, storeName,
          auditDate: dateOnly(get(r, ar.idx, 'auditDate')),
          zone: get(r, ar.idx, 'zone'),
          checkpoint: get(r, ar.idx, 'checkpoint'),
          response,
          remark: get(r, ar.idx, 'remark'),
          photoUrls: get(r, ar.idx, 'photoUrls'),
          temperatureDegree: get(r, ar.idx, 'temperatureDegree'),
        });
      }
    }
  }
  console.log(`  ${ar.rows.length - arSkippedDupe} response rows across ${paramStats.size} mapped parameters (${arSkippedDupe} skipped, tied to a superseded resubmission)`);

  // ---------- Cadence: daily / weekly / monthly distinct PODs audited ----------
  const dailyMap = new Map(); // date -> {pods:Set, audits}
  const weeklyMap = new Map();
  const monthlyMap = new Map();
  for (const a of audits) {
    if (!dailyMap.has(a.date)) dailyMap.set(a.date, { date: a.date, pods: new Set(), audits: 0 });
    const d = dailyMap.get(a.date); d.pods.add(a.storeId); d.audits++;

    const wk = isoWeekLabel(a.date);
    if (!weeklyMap.has(wk.key)) weeklyMap.set(wk.key, { ...wk, pods: new Set(), audits: 0 });
    const w = weeklyMap.get(wk.key); w.pods.add(a.storeId); w.audits++;

    const mo = monthLabel(a.date);
    if (!monthlyMap.has(mo.key)) monthlyMap.set(mo.key, { ...mo, pods: new Set(), audits: 0 });
    const m = monthlyMap.get(mo.key); m.pods.add(a.storeId); m.audits++;
  }
  const daily = [...dailyMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({ date: d.date, pods: d.pods.size, audits: d.audits }));
  const weekly = [...weeklyMap.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((w) => ({ label: w.label, start: w.start, end: w.end, pods: w.pods.size, audits: w.audits }));
  const monthly = [...monthlyMap.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((m) => ({ label: m.label, pods: m.pods.size, audits: m.audits }));
  const today = dailyMap.get(maxDate) ? { pods: dailyMap.get(maxDate).pods.size, audits: dailyMap.get(maxDate).audits } : { pods: 0, audits: 0 };
  const thisWeekKey = isoWeekLabel(maxDate).key;
  const thisWeek = weeklyMap.has(thisWeekKey) ? { pods: weeklyMap.get(thisWeekKey).pods.size, audits: weeklyMap.get(thisWeekKey).audits } : { pods: 0, audits: 0 };
  const thisMonthKey = monthLabel(maxDate).key;
  const thisMonth = monthlyMap.has(thisMonthKey) ? { pods: monthlyMap.get(thisMonthKey).pods.size, audits: monthlyMap.get(thisMonthKey).audits } : { pods: 0, audits: 0 };

  // ---------- City rollup ----------
  const auditsByCity = new Map();
  for (const a of audits) {
    if (!auditsByCity.has(a.city)) auditsByCity.set(a.city, { audits: 0, storesAudited: new Set(), scoreSum: 0 });
    const c = auditsByCity.get(a.city); c.audits++; c.storesAudited.add(a.storeId); c.scoreSum += a.scorePercent;
  }
  const capaByCity = new Map();
  for (const c of capa) {
    if (!capaByCity.has(c.city)) capaByCity.set(c.city, { open: 0, closed: 0, inProgress: 0, overdue: 0, closedLate: 0 });
    const cc = capaByCity.get(c.city);
    if (c.status === 'Open') cc.open++;
    else if (c.status === 'In Progress') cc.inProgress++;
    else if (c.status === 'Closed') cc.closed++;
    if (c.slaState.includes('overdue')) cc.overdue++;
    if (c.slaState === 'closed_late') cc.closedLate++;
  }
  const allCities = new Set([...cityTotals.keys(), ...auditsByCity.keys()]);
  const cityRollup = [...allCities].map((city) => {
    const a = auditsByCity.get(city) || { audits: 0, storesAudited: new Set(), scoreSum: 0 };
    const cp = capaByCity.get(city) || { open: 0, closed: 0, inProgress: 0, overdue: 0, closedLate: 0 };
    const ncByParam = {};
    for (const [param, stat] of paramStats) {
      const cc = stat.byCity.get(city);
      ncByParam[param] = cc ? { nc: cc.nc, partial: cc.partial, total: cc.total } : { nc: 0, partial: 0, total: 0 };
    }
    return {
      city,
      cluster: clusterByCityResolved.get(city) || resolveCluster(null, city),
      totalStores: cityTotals.get(city) || 0,
      storesAudited: a.storesAudited.size,
      audits: a.audits,
      avgScore: a.audits ? Math.round((a.scoreSum / a.audits) * 10) / 10 : 0,
      capaOpen: cp.open, capaInProgress: cp.inProgress, capaClosed: cp.closed, capaOverdue: cp.overdue, capaClosedLate: cp.closedLate,
      ncByParam,
    };
  }).sort((a, b) => b.audits - a.audits);

  // ---------- POD (store) rollup ----------
  const capaByPod = new Map();
  for (const c of capa) {
    if (!capaByPod.has(c.storeId)) capaByPod.set(c.storeId, { open: 0, closed: 0, inProgress: 0, overdue: 0, closedLate: 0 });
    const cc = capaByPod.get(c.storeId);
    if (c.status === 'Open') cc.open++; else if (c.status === 'In Progress') cc.inProgress++; else if (c.status === 'Closed') cc.closed++;
    if (c.slaState.includes('overdue')) cc.overdue++;
    if (c.slaState === 'closed_late') cc.closedLate++;
  }
  const podAgg = new Map();
  for (const a of audits) {
    if (!podAgg.has(a.storeId)) podAgg.set(a.storeId, { storeId: a.storeId, storeName: a.storeName, city: a.city, audits: 0, lastAuditDate: '', lastScore: 0, scoreSum: 0 });
    const p = podAgg.get(a.storeId);
    p.audits++; p.scoreSum += a.scorePercent;
    if (a.date >= p.lastAuditDate) { p.lastAuditDate = a.date; p.lastScore = a.scorePercent; }
  }
  const podRollup = [...podAgg.values()].map((p) => {
    const cp = capaByPod.get(p.storeId) || { open: 0, closed: 0, inProgress: 0, overdue: 0, closedLate: 0 };
    const ncByParam = {};
    for (const [param, stat] of paramStats) {
      const pp = stat.byPod.get(p.storeId);
      ncByParam[param] = pp ? { nc: pp.nc, partial: pp.partial, total: pp.total } : { nc: 0, partial: 0, total: 0 };
    }
    const pMeta = storeMeta.get(p.storeId) || {};
    return {
      storeId: p.storeId, storeName: p.storeName, city: p.city,
      cluster: pMeta.cluster || resolveCluster(p.storeId, p.city),
      audits: p.audits, avgScore: Math.round((p.scoreSum / p.audits) * 10) / 10,
      lastAuditDate: p.lastAuditDate, lastScore: p.lastScore,
      capaOpen: cp.open, capaInProgress: cp.inProgress, capaClosed: cp.closed, capaOverdue: cp.overdue, capaClosedLate: cp.closedLate,
      ncByParam,
    };
  }).sort((a, b) => (b.capaOverdue - a.capaOverdue) || (b.audits - a.audits));

  // ---------- categoryStats output ----------
  const parameters = [...paramStats.entries()].map(([key, s]) => {
    const total = s.compliant + s.nonCompliant + s.partial + s.na;
    return {
      key, ...PARAM_META[key],
      compliant: s.compliant, nonCompliant: s.nonCompliant, partial: s.partial, na: s.na, total,
      complianceRate: total ? Math.round((s.compliant / total) * 1000) / 10 : 0,
      ncRate: total ? Math.round(((s.nonCompliant + s.partial) / total) * 1000) / 10 : 0,
      byCity: [...s.byCity.entries()].map(([city, v]) => ({ city, ...v })).sort((a, b) => (b.nc + b.partial) - (a.nc + a.partial)),
      byPod: [...s.byPod.entries()].map(([, v]) => v).sort((a, b) => (b.nc + b.partial) - (a.nc + a.partial)),
    };
  }).sort((a, b) => HEADLINE_ORDER.indexOf(a.key) - HEADLINE_ORDER.indexOf(b.key));

  const drilldownOut = {};
  for (const [key, list] of drilldown) drilldownOut[key] = list;

  // ---------- brand-level compliance output (FNV / Noice / Other Brands) ----------
  const categoryCompliance = {};
  for (const name of CATEGORY_NAMES) categoryCompliance[name] = [];
  for (const [bKey, s] of brandParamStats) {
    const sepIdx = bKey.indexOf('|');
    const brandName = bKey.slice(0, sepIdx);
    const paramKey = bKey.slice(sepIdx + 1);
    const total = s.compliant + s.nonCompliant + s.partial + s.na;
    categoryCompliance[brandName].push({
      key: paramKey, ...PARAM_META[paramKey],
      compliant: s.compliant, nonCompliant: s.nonCompliant, partial: s.partial, na: s.na, total,
      complianceRate: total ? Math.round((s.compliant / total) * 1000) / 10 : 0,
      ncRate: total ? Math.round(((s.nonCompliant + s.partial) / total) * 1000) / 10 : 0,
      byCity: [...s.byCity.entries()].map(([city, v]) => ({ city, ...v })).sort((a, b) => (b.nc + b.partial) - (a.nc + a.partial)),
      byPod: [...s.byPod.entries()].map(([, v]) => v).sort((a, b) => (b.nc + b.partial) - (a.nc + a.partial)),
    });
  }
  for (const name of CATEGORY_NAMES) categoryCompliance[name].sort((a, b) => HEADLINE_ORDER.indexOf(a.key) - HEADLINE_ORDER.indexOf(b.key));
  console.log(`  Brand breakdown: ${CATEGORY_NAMES.map((n) => n + '=' + categoryCompliance[n].length + ' params').join(', ')}`);

  const categoryDrilldownOut = {};
  for (const [key, list] of categoryDrilldown) categoryDrilldownOut[key] = list;

  // ---------- Audit SKU wise: per-SKU expiry / FEFO / puffing / location findings ----------
  console.log('Loading Audit SKU wise checks...');
  const skuCsv = loadMerged(FILE.sku);
  const skuAgg = { total: 0, expired: 0, fefoViolations: 0, puffingViolations: 0, locationDeviations: 0 };
  const skuByCity = new Map(), skuByPod = new Map();
  const skuExpiredList = []; // drilldown: actual expired SKU findings with names
  let skuSkippedDupe = 0;
  for (const r of skuCsv.rows) {
    if (!keptAuditIds.has(get(r, skuCsv.idx, 'auditId'))) { skuSkippedDupe++; continue; }
    const storeId = get(r, skuCsv.idx, 'storeId');
    const city = (storeMeta.get(storeId) || {}).city || get(r, skuCsv.idx, 'storeLocation') || 'Unknown';
    const storeName = get(r, skuCsv.idx, 'storeName') || (storeMeta.get(storeId) || {}).storeName || city;
    const expiry = get(r, skuCsv.idx, 'expiry');
    const fefoOk = get(r, skuCsv.idx, 'fefoOk');
    const puffingOk = get(r, skuCsv.idx, 'puffingOk');
    const deviation = get(r, skuCsv.idx, 'deviationLocation');
    skuAgg.total++;
    const isExpired = expiry === 'Expiry';
    const isFefoViolation = fefoOk === 'N';
    const isPuffingViolation = puffingOk === 'N';
    const isLocationDeviation = !!deviation;
    if (isExpired) skuAgg.expired++;
    if (isFefoViolation) skuAgg.fefoViolations++;
    if (isPuffingViolation) skuAgg.puffingViolations++;
    if (isLocationDeviation) skuAgg.locationDeviations++;
    if (isExpired || isFefoViolation || isPuffingViolation || isLocationDeviation) {
      if (!skuByCity.has(city)) skuByCity.set(city, { city, expired: 0, fefo: 0, puffing: 0, location: 0, total: 0 });
      const cc = skuByCity.get(city); cc.total++;
      if (isExpired) cc.expired++; if (isFefoViolation) cc.fefo++; if (isPuffingViolation) cc.puffing++; if (isLocationDeviation) cc.location++;
      const podKey = storeId || storeName;
      if (!skuByPod.has(podKey)) skuByPod.set(podKey, { storeId, storeName, city, expired: 0, fefo: 0, puffing: 0, location: 0, total: 0 });
      const pp = skuByPod.get(podKey); pp.total++;
      if (isExpired) pp.expired++; if (isFefoViolation) pp.fefo++; if (isPuffingViolation) pp.puffing++; if (isLocationDeviation) pp.location++;
    }
    if (isExpired) {
      skuExpiredList.push({
        city, storeId, storeName,
        auditDate: dateOnly(get(r, skuCsv.idx, 'auditDate')),
        skuName: get(r, skuCsv.idx, 'skuName'),
        zone: get(r, skuCsv.idx, 'zone'),
        brand: get(r, skuCsv.idx, 'brand'),
        remark: get(r, skuCsv.idx, 'expiryRemarks') || get(r, skuCsv.idx, 'remarks'),
        photoUrl: get(r, skuCsv.idx, 'expiryPhotoUrl') || get(r, skuCsv.idx, 'photoUrl'),
      });
    }
  }
  console.log(`  ${skuAgg.total} SKU checks (${skuSkippedDupe} skipped, tied to a superseded resubmission): ${skuAgg.expired} expired, ${skuAgg.fefoViolations} FEFO violations, ${skuAgg.puffingViolations} puffing violations, ${skuAgg.locationDeviations} location deviations`);

  // ---------- Zone verify check: SKU found in wrong storage zone ----------
  console.log('Loading Zone verify checks...');
  const zv = loadMerged(FILE.zoneVerify);
  const auditIndex = new Map(audits.map((a) => [a.id, a])); // auditId -> canonical audit (city/store)
  const zvAgg = { total: 0, wrongLocation: 0 };
  const zvByCity = new Map();
  let zvSkippedDupe = 0;
  for (const r of zv.rows) {
    const auditId = get(r, zv.idx, 'auditId');
    if (!keptAuditIds.has(auditId)) { zvSkippedDupe++; continue; }
    const a = auditIndex.get(auditId);
    const city = a ? a.city : 'Unknown';
    zvAgg.total++;
    const wrong = get(r, zv.idx, 'correctLocation') === 'No';
    if (wrong) {
      zvAgg.wrongLocation++;
      if (!zvByCity.has(city)) zvByCity.set(city, { city, wrongLocation: 0, total: 0 });
      zvByCity.get(city).wrongLocation++;
    }
  }
  console.log(`  ${zvAgg.total} zone-verify checks (${zvSkippedDupe} skipped, tied to a superseded resubmission): ${zvAgg.wrongLocation} wrong-location findings`);

  // ---------- Expiry Check Items: network-wide only (export has no store/audit reference) ----------
  console.log('Loading Expiry Check Items (network-wide, no store linkage available)...');
  const eci = loadMerged(FILE.expiryItems);
  let eciExpired = 0;
  for (const r of eci.rows) if (get(r, eci.idx, 'status') === 'Expiry') eciExpired++;
  console.log(`  ${eci.rows.length} items logged: ${eciExpired} flagged expired`);

  const clusterNames = Array.from(new Set([...storeMeta.values()].map((v) => v.cluster))).sort((a, b) => (a === 'Unmapped' ? 1 : b === 'Unmapped' ? -1 : a.localeCompare(b)));
  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      dataAsOf: maxDate,
      dateRange: { from: audits[0] ? audits[0].date : null, to: maxDate },
      totals: {
        totalStoresInNetwork: sm.rows.length,
        totalCitiesInNetwork: cityTotals.size,
        totalClustersInNetwork: clusterNames.filter((c) => c !== 'Unmapped').length,
        totalAuditsDeduped: audits.length,
        totalAuditsRaw: au.rows.length,
        totalPodsAudited: podAgg.size,
        totalCitiesAudited: auditsByCity.size,
        totalCapaTasks: capa.length,
      },
      clusters: clusterNames,
      capaStatusCounts, capaSlaCounts,
      dataSources: {
        used: ['Store Master', 'Audits', 'CAPA Tasks', 'Audit Responses', 'Audit SKU Checks', 'Audit Zone Verify Checks', 'Cluster Details'],
        excluded: [
          { name: 'Audit Response (Wide)', reason: 'Same data as Audit Responses, pivoted wide — redundant with the long format already used.' },
          { name: 'Audit Logs', reason: 'App-usage telemetry (session/page-view events), not audit findings — no compliance content to report.' },
        ],
        expiryCheckItemsNote: 'Expiry Check Items export has no storeId/auditId column, so it is reported network-wide only (not attributable to a city or POD).',
        clusterMappingNote: `Cluster comes from the "Cluster details" export, joined by Pod ID first and by City as a fallback (3 city-name spelling differences reconciled). ${unmappedStoreCount} of ${sm.rows.length} stores have no cluster in that export and are grouped under "Unmapped".`,
      },
    },
    audits,
    capa,
    cadence: { daily, weekly, monthly, today, thisWeek, thisMonth },
    categoryStats: { parameters },
    categoryCompliance,
    categoryDrilldown: categoryDrilldownOut,
    cityRollup,
    podRollup,
    drilldown: drilldownOut,
    skuFindings: {
      ...skuAgg,
      byCity: [...skuByCity.values()].sort((a, b) => (b.expired + b.fefo + b.puffing + b.location) - (a.expired + a.fefo + a.puffing + a.location)),
      byPod: [...skuByPod.values()].sort((a, b) => (b.expired + b.fefo + b.puffing + b.location) - (a.expired + a.fefo + a.puffing + a.location)),
      expiredList: skuExpiredList,
    },
    zoneVerify: {
      ...zvAgg,
      byCity: [...zvByCity.values()].sort((a, b) => b.wrongLocation - a.wrongLocation),
    },
    expiryCheckItemsNetworkWide: {
      totalItems: eci.rows.length,
      expiredFlagged: eciExpired,
      nonExpiryFlagged: eci.rows.length - eciExpired,
    },
  };

  fs.writeFileSync(OUT_JS, 'window.DASHBOARD_DATA = ' + JSON.stringify(output) + ';\n');
  const sizeMB = (fs.statSync(OUT_JS).size / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${OUT_JS} (${sizeMB} MB)`);
}

main();
