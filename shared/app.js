/* ============================================================
   POD Audit & CAPA Command Center — shared application logic
   Consumed by BOTH format-scroll.html and format-tabbed.html.
   Each host page only needs to provide containers with the IDs
   referenced below, in whatever layout it likes.
   ============================================================ */
(function(global){
  "use strict";
  var D = global.DASHBOARD_DATA;
  var C = global.Charts;
  var esc = C.esc, fmt = C.fmt, pct = C.pct;

  var STATE_META = {
    closed_on_time:        { label:'Closed on time',              tone:'good', color:'var(--good)',  icon:'check-circle' },
    closed_late:           { label:'Closed late (missed 3 days)', tone:'warn', color:'var(--warn)',  icon:'clock-progress' },
    open_on_track:         { label:'Open — still within 3 days',  tone:'info', color:'var(--info)',  icon:'alert-circle' },
    open_overdue:          { label:'Open — overdue',              tone:'bad',  color:'var(--bad)',   icon:'flame-overdue' },
    in_progress_on_track:  { label:'In progress — still within 3 days', tone:'teal', color:'var(--accent2)', icon:'clock-progress' },
    in_progress_overdue:   { label:'In progress — overdue',       tone:'bad',  color:'#8a1a10',      icon:'flame-overdue' }
  };
  var ZONE_COLOR = { headline_expiry:'var(--z-expiry)', 'Expiry-Removal':'var(--z-expiry)', 'Chiller-Temp':'var(--z-chiller)', 'Freezer-Temp':'var(--z-freezer)', 'AC Room-Temp':'var(--z-acroom)', 'Inward-Temp':'var(--z-inward)' };
  function zoneColor(key){ return ZONE_COLOR[key] || 'var(--z-other)'; }

  // ---------------- filter state ----------------
  var state = {
    cities: null,   // Set or null = all
    pods: null,     // Set of storeId or null = all
    clusters: null, // Set of cluster name or null = all
    geoMode: 'pan', // 'pan' | 'cluster' | 'city' — which geo toggle button is active (UI-level, independent of whether a subset is actually picked)
    dateFrom: D.meta.dateRange.from,
    dateTo: D.meta.dateRange.to,
    cadenceGranularity: 'month', // 'day' | 'week' | 'month' — which trend the top-of-page toggle shows
    skuGroupBy: 'city',          // 'city' | 'store' | 'sku' — Expiry & SKU findings grouping
    latestOnly: false,           // true = collapse to the single latest audit per store (Pod Audits sheet toggle)
    categoryTab: 'exec'          // 'exec' | 'FNV' | 'Noice' | 'DBEM' — the business-category sub-tab
  };
  var ALL_CITIES = D.cityRollup.map(function(c){ return c.city; }).sort();
  var ALL_PODS = D.podRollup.map(function(p){ return { id:p.storeId, label:p.storeName+' — '+p.city, city:p.city }; }).sort(function(a,b){ return a.label.localeCompare(b.label); });
  var ALL_CLUSTERS = (D.meta.clusters || []).slice();
  var STORE_CLUSTER = {}; D.podRollup.forEach(function(p){ STORE_CLUSTER[p.storeId] = p.cluster; });
  var CITY_CLUSTER = {}; D.cityRollup.forEach(function(c){ CITY_CLUSTER[c.city] = c.cluster; });
  function clusterForRecord(r){ return r.cluster || STORE_CLUSTER[r.storeId] || CITY_CLUSTER[r.city] || 'Unmapped'; }

  function within(dateStr){
    if (!dateStr) return true;
    return dateStr >= state.dateFrom && dateStr <= state.dateTo;
  }
  function cityOk(city){ return !state.cities || state.cities.has(city); }
  function podOk(storeId){ return !state.pods || state.pods.has(storeId); }
  function clusterOk(cluster){ return !state.clusters || state.clusters.has(cluster); }

  function isDefaultFilters(){
    return !state.cities && !state.pods && !state.clusters && state.dateFrom === D.meta.dateRange.from && state.dateTo === D.meta.dateRange.to;
  }

  // ---------------- filtered views ----------------
  function computeFiltered(){
    var audits = D.audits.filter(function(a){ return cityOk(a.city) && podOk(a.storeId) && clusterOk(a.cluster) && within(a.date); });
    if (state.latestOnly){
      var latestByStore = {};
      audits.forEach(function(a){ if (!latestByStore[a.storeId] || a.date > latestByStore[a.storeId].date) latestByStore[a.storeId] = a; });
      audits = Object.keys(latestByStore).map(function(k){ return latestByStore[k]; });
    }
    var capa = D.capa.filter(function(c){ return cityOk(c.city) && podOk(c.storeId) && clusterOk(c.cluster) && within(c.auditDate); });
    var drilldown = {};
    Object.keys(D.drilldown).forEach(function(k){
      drilldown[k] = D.drilldown[k].filter(function(r){ return cityOk(r.city) && podOk(r.storeId) && clusterOk(clusterForRecord(r)) && within(r.auditDate); });
    });
    var skuExpired = D.skuFindings.expiredList.filter(function(r){ return cityOk(r.city) && podOk(r.storeId) && clusterOk(clusterForRecord(r)) && within(r.auditDate); });
    var cities = new Set(audits.map(function(a){ return a.city; }));
    return { audits:audits, capa:capa, drilldown:drilldown, skuExpired:skuExpired, citiesAudited:cities };
  }

  // ---------------- date helpers ----------------
  function dow(dstr){ return new Date(dstr+'T00:00:00Z'); }
  function isoWeekKey(d){
    var dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = (dt.getUTCDay()+6)%7; dt.setUTCDate(dt.getUTCDate()-day+3);
    var firstThu = new Date(Date.UTC(dt.getUTCFullYear(),0,4));
    var week = 1 + Math.round(((dt-firstThu)/86400000 - 3 + ((firstThu.getUTCDay()+6)%7))/7);
    return dt.getUTCFullYear()+'-W'+String(week).padStart(2,'0');
  }

  // ================================================================
  // SECTION: KPI cards
  // ================================================================
  function renderKPIs(f){
    var el = document.getElementById('kpiGrid'); if (!el) return;
    var totalAudits = f.audits.length;
    var podsAudited = new Set(f.audits.map(function(a){ return a.storeId; })).size;
    var citiesCovered = f.citiesAudited.size;
    var avgScore = totalAudits ? Math.round(f.audits.reduce(function(a,x){ return a+x.scorePercent; },0)/totalAudits) : 0;
    var capaOpen = f.capa.filter(function(c){ return c.status==='Open'; }).length;
    var capaOverdue = f.capa.filter(function(c){ return c.slaState==='open_overdue'||c.slaState==='in_progress_overdue'; }).length;
    var overduePct = pct(capaOverdue, f.capa.length);
    var closedOnTime = f.capa.filter(function(c){ return c.slaState==='closed_on_time'; }).length;
    var closedTotal = f.capa.filter(function(c){ return c.status==='Closed'; }).length;
    var onTimeRate = pct(closedOnTime, closedTotal);

    var cards = [
      { key:'audits', value:fmt(totalAudits), label:'Total audits (deduped)', sub:D.meta.totals.totalAuditsRaw+' raw submissions received' },
      { key:'pods', value:fmt(podsAudited), label:'PODs audited', sub:pct(podsAudited, D.meta.totals.totalStoresInNetwork)+'% of '+fmt(D.meta.totals.totalStoresInNetwork)+' network stores' },
      { key:'cities', value:fmt(citiesCovered), label:'Cities covered', sub:pct(citiesCovered, D.meta.totals.totalCitiesInNetwork)+'% of '+fmt(D.meta.totals.totalCitiesInNetwork)+' network cities' },
      { key:'score', value:avgScore+'%', label:'Average audit score', sub:'Across '+fmt(totalAudits)+' audits in range' },
      { key:'capaopen', value:fmt(capaOpen), label:'CAPA tasks open', sub:fmt(f.capa.length)+' total CAPA tasks raised' },
      { key:'overdue', value:overduePct+'%', label:'CAPA past the 3-day deadline', sub:fmt(capaOverdue)+' tasks overdue right now' },
      { key:'ontime', value:onTimeRate+'%', label:'CAPA closed on time', sub:fmt(closedOnTime)+' of '+fmt(closedTotal)+' closed within 3 days' },
    ];
    cards = cards.concat(zoneNonCompliantCards());
    el.innerHTML = cards.map(C.kpiCard).join('');
  }

  // Plain "non-compliant stores" count per headline zone check — mirrors the
  // simple reference dashboard's KPI row (Expiry/Chiller/Freezer/AC Room/Inward).
  var ZONE_KPI_ORDER = ['Expiry-Removal','Chiller-Temp','Freezer-Temp','AC Room-Temp','Inward-Temp'];
  var ZONE_KPI_LABEL = {
    'Expiry-Removal':'Expiry removal — non-compliant PODs',
    'Chiller-Temp':'Chiller temp — non-compliant PODs',
    'Freezer-Temp':'Freezer temp — non-compliant PODs',
    'AC Room-Temp':'AC room temp — non-compliant PODs',
    'Inward-Temp':'Inward temp record — non-compliant PODs'
  };
  function zoneStoreSource(p){
    var src = p.byPod;
    if (state.pods) src = src.filter(function(x){ return state.pods.has(x.storeId); });
    if (state.cities) src = src.filter(function(x){ return state.cities.has(x.city); });
    if (state.clusters) src = src.filter(function(x){ return x.cluster && state.clusters.has(x.cluster); });
    return src;
  }
  function zoneNonCompliantCards(){
    return ZONE_KPI_ORDER.map(function(key){
      var p = D.categoryStats.parameters.find(function(x){ return x.key===key; });
      if (!p) return null;
      var ncStores = zoneStoreSource(p).filter(function(x){ return x.nc>0; }).length;
      return { key:'zone-'+key, value:fmt(ncStores), label:ZONE_KPI_LABEL[key] };
    }).filter(Boolean);
  }

  // Same "non-compliant PODs" cards, scoped to one business category (FNV/Noice/DBEM) —
  // only the headline params that actually apply to that category get a card.
  function categoryNonCompliantCards(cat){
    var catParams = D.categoryCompliance[cat] || [];
    return ZONE_KPI_ORDER.map(function(key){
      var p = catParams.find(function(x){ return x.key===key; });
      if (!p) return null;
      var ncStores = zoneStoreSource(p).filter(function(x){ return x.nc>0; }).length;
      return { key:cat+'-'+key, value:fmt(ncStores), label:ZONE_KPI_LABEL[key] };
    }).filter(Boolean);
  }

  // Day/Week/Month is a single top-of-section toggle (state.cadenceGranularity),
  // not three simultaneous breakdowns — the user found "today/week/month all at once" confusing.
  function bucketKey(dateStr, gran){
    if (gran==='week') return isoWeekKey(dow(dateStr));
    if (gran==='month') return dateStr.slice(0,7);
    return dateStr;
  }
  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function bucketLabel(key, gran){
    if (gran==='month'){ var p = key.split('-'); return MONTH_NAMES[(+p[1])-1]+' '+p[0]; }
    if (gran==='week') return key;
    return key.slice(5);
  }
  function initCadenceToggle(){
    var seg = document.getElementById('cadenceSeg'); if (!seg) return;
    seg.addEventListener('click', function(e){
      var btn = e.target.closest('.seg-btn'); if (!btn || !seg.contains(btn)) return;
      seg.querySelectorAll('.seg-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      state.cadenceGranularity = btn.getAttribute('data-gran');
      renderPodsAudited(computeFiltered());
    });
  }

  function renderPodsAudited(f){
    var gran = state.cadenceGranularity;
    var kpiEl = document.getElementById('cadenceKpis');
    if (kpiEl){
      var cur = gran==='day' ? D.cadence.today : gran==='week' ? D.cadence.thisWeek : D.cadence.thisMonth;
      var periodLabel = gran==='day' ? 'today' : gran==='week' ? 'this week' : 'this month';
      var cards = [
        { key:'pods', value:fmt(cur.pods), label:'PODs audited '+periodLabel, sub:fmt(cur.audits)+' audits '+periodLabel },
      ];
      kpiEl.innerHTML = cards.map(C.kpiCard).join('');
    }
    var chartEl = document.getElementById('cadenceChart'); if (!chartEl) return;
    var byKey = {};
    f.audits.forEach(function(a){
      var k = bucketKey(a.date, gran);
      (byKey[k] = byKey[k]||{pods:new Set(),audits:0}).audits++;
      byKey[k].pods.add(a.storeId);
    });
    var keys = Object.keys(byKey).sort();
    var points = keys.map(function(k){ return { x:bucketLabel(k,gran), y:byKey[k].pods.size, full:k, audits:byKey[k].audits }; });
    if (!points.length){ chartEl.innerHTML = '<div class="empty-state">No audits in the selected range.</div>'; return; }
    C.lineArea(chartEl, { points:points, height:200, color:'var(--accent)',
      onHover:function(p, e){ C.showTT('<b>'+esc(p.full)+'</b><br>PODs audited: '+p.y+'<br>Audits logged: '+p.audits, e); },
      onClick:function(p){ openAuditsOnBucketModal(p.full, gran, f); }
    });
  }

  function openAuditsOnBucketModal(key, gran, f){
    var rows = f.audits.filter(function(a){ return bucketKey(a.date, gran)===key; });
    var body = rows.length ? ('<div class="table-wrap"><table class="datatable"><thead><tr><th>City</th><th>POD</th><th>Score</th><th>NC</th><th>Partial</th></tr></thead><tbody>'+
      rows.map(function(r){ return '<tr><td>'+esc(r.city)+'</td><td>'+esc(r.storeName)+'</td><td>'+scoreBadge(r.scorePercent)+'</td><td>'+r.nc+'</td><td>'+r.pc+'</td></tr>'; }).join('')+
      '</tbody></table></div>') : '<div class="empty-state">No audits.</div>';
    openModal('calendar-day', 'Audits — '+bucketLabel(key,gran)+' ('+rows.length+')', body);
  }

  function scoreBadge(score){
    var tone = score>=80?'good':score>=60?'warn':'bad';
    return '<span class="badge '+tone+'">'+score+'%</span>';
  }

  // ================================================================
  // SECTION: CAPA status + SLA
  // ================================================================
  // Rolls CAPA task rows up to one row per store — status is the store's worst
  // task (Open > In Progress > Closed) and slaBucket is its worst SLA outcome
  // (overdue > closed late > fully on time > other-still-open). One shared
  // rollup feeds the status donut, the city bar, and the table below, so "how
  // many stores" always means the same set of stores everywhere on this tab —
  // raw per-task counts (overdue/closedLate) are kept only as secondary detail.
  function computeStoreCapaSummary(rows){
    var byStore = {};
    rows.forEach(function(c){
      var s = byStore[c.storeId] = byStore[c.storeId] || { storeId:c.storeId, storeName:c.storeName, city:c.city, tasks:[], lastAuditDate:c.auditDate };
      s.tasks.push(c);
      if (c.auditDate > s.lastAuditDate) s.lastAuditDate = c.auditDate;
    });
    return Object.keys(byStore).map(function(k){
      var s = byStore[k];
      s.status = s.tasks.some(function(t){ return t.status==='Open'; }) ? 'Open'
        : s.tasks.some(function(t){ return t.status==='In Progress'; }) ? 'In Progress' : 'Closed';
      s.overdue = s.tasks.filter(function(t){ return t.slaState==='open_overdue'||t.slaState==='in_progress_overdue'; }).length;
      s.closedLate = s.tasks.filter(function(t){ return t.slaState==='closed_late'; }).length;
      var allClosed = s.tasks.every(function(t){ return t.status==='Closed'; });
      s.slaBucket = s.overdue>0 ? 'overdue' : s.closedLate>0 ? 'late' : (allClosed ? 'onTime' : 'other');
      return s;
    });
  }

  function renderCapaSla(f){
    var statusEl = document.getElementById('capaDonut');
    var slaEl = document.getElementById('slaDonut');
    var barEl = document.getElementById('slaCityBar');
    var tableEl = document.getElementById('capaOverdueTable');
    var storeSummary = computeStoreCapaSummary(f.capa);

    if (statusEl){
      var byStatus = { Open:0, 'In Progress':0, Closed:0 };
      storeSummary.forEach(function(s){ byStatus[s.status] = (byStatus[s.status]||0)+1; });
      C.donut(statusEl, {
        centerLabel:'Stores', size:180,
        segments:[
          { label:'Open', value:byStatus.Open, color:'var(--warn)' },
          { label:'In Progress', value:byStatus['In Progress'], color:'var(--info)' },
          { label:'Closed', value:byStatus.Closed, color:'var(--good)' },
        ],
        onClick:function(seg){ openCapaStoreListModal(seg.label+' — stores', storeSummary.filter(function(s){ return s.status===seg.label; })); }
      });
    }
    if (slaEl){
      var byState = {};
      f.capa.forEach(function(c){ byState[c.slaState] = (byState[c.slaState]||0)+1; });
      var order = ['closed_on_time','closed_late','open_on_track','open_overdue','in_progress_on_track','in_progress_overdue'];
      C.donut(slaEl, {
        centerLabel:'vs 3-day deadline', size:180,
        segments:order.map(function(k){ return { label:STATE_META[k].label, value:byState[k]||0, color:STATE_META[k].color, key:k }; }),
        onClick:function(seg){ openCapaListModal(seg.label, f.capa.filter(function(c){ return c.slaState===seg.key; })); }
      });
    }
    if (barEl){
      var byCity = {};
      storeSummary.forEach(function(s){
        var b = byCity[s.city] = byCity[s.city] || { onTime:0, late:0, overdue:0, other:0 };
        b[s.slaBucket]++;
      });
      var cats = Object.keys(byCity).map(function(city){ return { label:city, data:byCity[city] }; })
        .sort(function(a,b){ return b.data.overdue - a.data.overdue; }).slice(0, 14)
        .map(function(c){ return { label:c.label, segments:[
          { value:c.data.overdue, color:'var(--bad)', label:'Overdue' },
          { value:c.data.late, color:'var(--warn)', label:'Closed late' },
          { value:c.data.onTime, color:'var(--good)', label:'Closed on time' },
          { value:c.data.other, color:'var(--info)', label:'Other open (still within 3 days)' },
        ] }; });
      C.stackedBar(barEl, { categories:cats, height:230,
        onClick:function(cat){ openCapaStoreListModal(cat.label+' — stores', storeSummary.filter(function(s){ return s.city===cat.label; })); },
        onHover:function(cat, e){ var d=byCity[cat.label]; C.showTT('<b>'+esc(cat.label)+'</b><br>Overdue: '+d.overdue+'<br>Closed late: '+d.late+'<br>Closed on time: '+d.onTime+'<br>Other (still within 3 days): '+d.other, e); }
      });
    }
    if (tableEl){
      // Store-wise, not checkpoint-wise: one row per POD (grouped by City, worst-first
      // within each city) with its CAPA status + a text-only report link (no photos).
      var storeRows = storeSummary.slice()
        .sort(function(a,b){ return a.city.localeCompare(b.city) || b.overdue-a.overdue || a.storeName.localeCompare(b.storeName); });
      renderGenericTable(tableEl, {
        columns:[
          { key:'city', label:'City' },
          { key:'storeName', label:'Store / POD', wide:true },
          { key:'status', label:'Status', render:function(r){
            if (r.status==='Closed') return '<span class="badge good">Closed</span>';
            if (r.status==='In Progress') return '<span class="badge info">In progress</span>';
            return '<span class="badge warn">Open</span>';
          } },
          { key:'overdue', label:'Overdue (past 3-day deadline)', render:function(r){ return r.overdue ? '<span class="badge bad">'+r.overdue+'</span>' : '—'; } },
          { key:'closedLate', label:'Closed late', render:function(r){ return r.closedLate ? '<span class="badge warn">'+r.closedLate+'</span>' : '—'; } },
          { key:'lastAuditDate', label:'Last audit' },
        ],
        rows: storeRows, pageSize: 10, searchable: true,
        onRowClick: function(r){ openCapaListModal(r.city+' — '+r.storeName, f.capa.filter(function(c){ return c.storeId===r.storeId; })); },
        onViewReport: function(r){ openStoreReportModal(r.storeId); }
      });
    }
  }

  function openCapaListModal(title, rows){
    var body = '<div class="table-wrap"><table class="datatable"><thead><tr><th>City</th><th>POD</th><th>Checkpoint</th><th>Status</th><th>Days overdue</th></tr></thead><tbody>'+
      rows.slice(0,400).map(function(r){ return '<tr class="rowlink" data-id="'+esc(r.capaId)+'"><td>'+esc(r.city)+'</td><td>'+esc(r.storeName)+'</td><td>'+esc(r.checkpoint)+'</td><td>'+esc(r.status)+'</td><td>'+(r.overdueDays>0?('<span class="badge bad">'+r.overdueDays+'d</span>'):'—')+'</td></tr>'; }).join('')+
      '</tbody></table></div>'+(rows.length>400?'<div class="section-sub" style="margin-top:8px">Showing first 400 of '+rows.length+' matching tasks.</div>':'');
    openModal('clipboard-list', title+' — '+fmt(rows.length)+' CAPA tasks', body);
    var modalBody = document.querySelector('#modalRoot .modal-body');
    modalBody.querySelectorAll('.rowlink').forEach(function(tr){
      tr.addEventListener('click', function(){
        var r = rows.find(function(x){ return x.capaId === tr.getAttribute('data-id'); });
        if (r) openCapaFindingModal(r);
      });
    });
  }

  // Store-level counterpart to openCapaListModal — one row per store instead of
  // one row per checkpoint task, so "how many" always means "how many stores".
  function openCapaStoreListModal(title, storeRows){
    var rows = storeRows.slice().sort(function(a,b){ return a.city.localeCompare(b.city) || a.storeName.localeCompare(b.storeName); });
    var body = '<div class="table-wrap"><table class="datatable"><thead><tr><th>City</th><th>Store / POD</th><th>Status</th><th>Overdue</th><th>Closed late</th><th></th></tr></thead><tbody>'+
      rows.slice(0,400).map(function(r){
        var statusBadge = r.status==='Closed' ? '<span class="badge good">Closed</span>' : r.status==='In Progress' ? '<span class="badge info">In progress</span>' : '<span class="badge warn">Open</span>';
        return '<tr class="rowlink" data-id="'+esc(r.storeId)+'"><td>'+esc(r.city)+'</td><td>'+esc(r.storeName)+'</td><td>'+statusBadge+'</td>'+
          '<td>'+(r.overdue?('<span class="badge bad">'+r.overdue+'</span>'):'—')+'</td>'+
          '<td>'+(r.closedLate?('<span class="badge warn">'+r.closedLate+'</span>'):'—')+'</td>'+
          '<td><button type="button" class="view-report-btn" data-report-btn data-id="'+esc(r.storeId)+'">'+icon('note',{size:11})+'View report</button></td></tr>';
      }).join('')+
      '</tbody></table></div>'+(rows.length>400?'<div class="section-sub" style="margin-top:8px">Showing first 400 of '+rows.length+' matching stores.</div>':'');
    openModal('clipboard-list', title+' — '+fmt(rows.length)+' stores', body);
    var modalBody = document.querySelector('#modalRoot .modal-body');
    modalBody.querySelectorAll('[data-report-btn]').forEach(function(btn){
      btn.addEventListener('click', function(e){ e.stopPropagation(); openStoreReportModal(btn.getAttribute('data-id')); });
    });
    modalBody.querySelectorAll('.rowlink').forEach(function(tr){
      tr.addEventListener('click', function(){
        var r = rows.find(function(x){ return x.storeId === tr.getAttribute('data-id'); });
        if (r) openCapaListModal(r.city+' — '+r.storeName, r.tasks);
      });
    });
  }

  function photoLinksHtml(photoUrls){
    if (!photoUrls) return '<span style="color:var(--text-faint);font-size:11.5px">No photo attached</span>';
    return photoUrls.split(',').filter(Boolean).map(function(u,i){
      return '<a class="photo-link" href="'+esc(u.trim())+'" target="_blank" rel="noopener">'+icon('image',{size:11})+'Photo '+(i+1)+'</a>';
    }).join('');
  }

  function openCapaFindingModal(r){
    var meta = STATE_META[r.slaState] || {};
    var body =
      '<div class="finding-card">'+
        '<div class="fc-top"><span class="fc-title">'+esc(r.checkpoint)+'</span><span class="badge '+(meta.tone||'neutral')+'">'+icon(meta.icon||'info',{size:10})+esc(meta.label||r.slaState)+'</span></div>'+
        '<div class="fc-meta">'+esc(r.city)+' · '+esc(r.storeName)+' (ID '+esc(r.storeId)+') · Audited '+esc(r.auditDate)+' · Zone: '+esc(r.zone||'—')+'</div>'+
        '<div class="fc-remark"><b>Auditor remark:</b> '+esc(r.remark||'—')+'</div>'+
        '<div class="fc-remark"><b>Assigned to:</b> '+esc(r.assignedPodEmail||'—')+' &nbsp; <b>CAPA due:</b> '+esc((r.dueAt||'').slice(0,10))+'</div>'+
        (r.status==='Closed' ? '<div class="fc-remark"><b>Closure remark:</b> '+esc(r.closureRemark||'—')+' &nbsp; <b>Closed by:</b> '+esc(r.closedBy||'—')+' on '+esc((r.closedAt||'').slice(0,10))+'</div>' : '')+
      '</div>';
    openModal('alert-circle', 'CAPA finding — '+r.capaId, body);
  }

  // ================================================================
  // SECTION: category / parameter compliance
  // ================================================================
  // Counts distinct PODs per compliance bucket (nc>0 -> non-compliant; else
  // partial>0 -> partially compliant; else -> fully compliant) — same POD-level
  // classification used by zoneNonCompliantCards/categoryNonCompliantCards and by
  // the table's own expand-list (bucketRows), so the summary row always matches
  // both the KPI cards above and the drill-down list underneath it.
  function paramPodCounts(param){
    var source = zoneStoreSource(param);
    var nc=0, partial=0, fully=0;
    source.forEach(function(x){
      if (x.nc>0) nc++;
      else if (x.partial>0) partial++;
      else fully++;
    });
    return { total: source.length, nc:nc, partial:partial, compliant:fully };
  }

  // One plain table: Category | Parameter | Fully / Partially / Non compliant.
  // Category here is the real business grouping (FNV / Noice / DBEM / Other Brands),
  // sourced from D.categoryCompliance — NOT the storage zone (Chiller/Freezer/AC Room/etc),
  // which is a separate concept (a checklist parameter, e.g. "Chiller-Temp").
  // Click a parameter row to expand the City → POD list; click a count to
  // switch which bucket that list shows. Store rows link to the finding detail.
  var CATEGORY_ORDER = ['FNV','Noice','DBEM','Other Brands'];
  var CATEGORY_TABS = [
    { key:'exec', label:'Executive Summary' },
    { key:'FNV', label:'FNV' },
    { key:'Noice', label:'NOICE' },
    { key:'DBEM', label:'DBEM' }
  ];

  function categoryComplianceRows(catFilter){
    var cats = (catFilter && catFilter !== 'exec') ? [catFilter] : CATEGORY_ORDER;
    var rows = [];
    cats.forEach(function(cat){
      (D.categoryCompliance[cat] || []).forEach(function(p){
        var c = paramPodCounts(p);
        rows.push({ p:p, category:cat, fully:c.compliant, partial:c.partial, nc:c.nc, total:c.total });
      });
    });
    return rows;
  }

  function renderCategoryCompliance(){
    var el = document.getElementById('complianceTable'); if (!el) return;
    var rows = categoryComplianceRows(state.categoryTab);

    var expandedKey = null, expandedBucket = 'nc';

    function bucketRows(r, bucket){
      var source = zoneStoreSource(r.p);
      return source.filter(function(x){
        if (bucket==='nc') return x.nc>0;
        if (bucket==='partial') return x.nc===0 && x.partial>0;
        return x.nc===0 && x.partial===0;
      }).sort(function(a,b){ return a.city.localeCompare(b.city) || a.storeName.localeCompare(b.storeName); });
    }
    var BUCKET_LABEL = { fully:'FULLY COMPLIANT', partial:'PARTIALLY COMPLIANT', nc:'NON COMPLIANT' };
    function rowKey(r){ return r.category+'|'+r.p.key; }
    function expandHtml(r){
      var list = bucketRows(r, expandedBucket);
      if (!list.length) return '<div class="empty-state">No PODs in this bucket for the current filters.</div>';
      return '<div class="compliance-expand-head">'+BUCKET_LABEL[expandedBucket]+' ('+fmt(list.length)+') — click a store for the finding detail</div>'+
        '<div class="compliance-expand-list">'+list.map(function(x){
          return '<div class="compliance-expand-row" data-store="'+esc(x.storeId)+'" data-cat="'+esc(r.category)+'" data-param="'+esc(r.p.key)+'"><span class="ce-city">'+esc(x.city)+'</span><span class="ce-store">'+esc(x.storeName)+'</span></div>';
        }).join('')+'</div>';
    }

    function draw(){
      el.innerHTML =
        '<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button type="button" class="reset-btn" id="complianceCsvBtn">Download CSV</button></div>'+
        '<div class="table-wrap"><table class="datatable compliance-table"><thead><tr>'+
          '<th>Category</th><th>Parameter</th><th style="text-align:right">Fully Compliant</th><th style="text-align:right">Partially Compliant</th><th style="text-align:right">Non Compliant</th>'+
        '</tr></thead><tbody>'+
        rows.map(function(r,i){
          var open = expandedKey===rowKey(r);
          var main = '<tr class="compliance-row" data-i="'+i+'" data-category="'+esc(r.category)+'">'+
            '<td>'+esc(r.category)+'</td>'+
            '<td class="param-cell">'+(open?'▾':'▸')+' '+esc(r.p.short)+'</td>'+
            '<td class="cnt-cell" data-bucket="fully"><span>'+fmt(r.fully)+'</span></td>'+
            '<td class="cnt-cell" data-bucket="partial"><span>'+fmt(r.partial)+'</span></td>'+
            '<td class="cnt-cell" data-bucket="nc"><span>'+fmt(r.nc)+'</span></td>'+
          '</tr>';
          return open ? main+'<tr class="compliance-expand"><td colspan="5">'+expandHtml(r)+'</td></tr>' : main;
        }).join('')+
        '</tbody></table></div>';

      el.querySelectorAll('.compliance-row').forEach(function(tr){
        tr.addEventListener('click', function(e){
          var i = +tr.getAttribute('data-i');
          var bucketCell = e.target.closest('.cnt-cell');
          if (bucketCell){ expandedKey = rowKey(rows[i]); expandedBucket = bucketCell.getAttribute('data-bucket'); }
          else if (expandedKey === rowKey(rows[i])){ expandedKey = null; }
          else { expandedKey = rowKey(rows[i]); expandedBucket = 'nc'; }
          draw();
        });
      });
      el.querySelectorAll('.compliance-expand-row').forEach(function(row){
        row.addEventListener('click', function(e){
          e.stopPropagation();
          var storeId = row.getAttribute('data-store');
          var cat = row.getAttribute('data-cat');
          var paramKey = row.getAttribute('data-param');
          var storeName = row.querySelector('.ce-store').textContent;
          var meta = metaFor(paramKey);
          var findings = (D.categoryDrilldown[cat+'|'+paramKey] || []).filter(function(x){ return x.storeId === storeId; });
          var body = findings.length ? findingsListHtml(findings)
            : '<div class="empty-state">No Non-Compliant or Partially Compliant findings recorded for <b>'+esc(meta.short)+'</b> ('+esc(cat)+') at this store — fully compliant across all audits in the current filters.</div>';
          openModal(meta.icon || 'note', storeName+' — '+meta.short, body);
        });
      });
      var csvBtn = document.getElementById('complianceCsvBtn');
      if (csvBtn) csvBtn.addEventListener('click', function(){ downloadComplianceCsv(rows); });
    }
    draw();
  }

  function downloadComplianceCsv(rows){
    var lines = ['Category,Parameter,Fully Compliant,Partially Compliant,Non Compliant'];
    rows.forEach(function(r){
      lines.push([r.category, r.p.short, r.fully, r.partial, r.nc].map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'category-parameter-compliance.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function findingsListHtml(rows){
    if (!rows.length) return '<div class="empty-state">No individual findings recorded for this selection.</div>';
    return rows.slice(0, 60).map(function(r){
      return '<div class="finding-card">'+
        '<div class="fc-top"><span class="fc-title">'+esc(r.checkpoint||r.category||'Finding')+'</span><span class="badge '+(r.response==='Non Compliance'?'bad':'warn')+'">'+esc(r.response)+'</span></div>'+
        '<div class="fc-meta">'+esc(r.city)+' · '+esc(r.storeName)+' · '+esc(r.auditDate||'')+(r.temperatureDegree?(' · '+esc(r.temperatureDegree)+'°C'):'')+'</div>'+
        (r.remark ? '<div class="fc-remark">'+esc(r.remark)+'</div>' : '')+
        '<div class="fc-photos">'+photoLinksHtml(r.photoUrls)+'</div>'+
      '</div>';
    }).join('') + (rows.length>60 ? '<div class="section-sub">Showing 60 of '+rows.length+' findings.</div>' : '');
  }

  // ================================================================
  // SECTION: city / POD rollup tables
  // ================================================================
  function renderCityPodTables(f){
    var cityEl = document.getElementById('cityTable');
    if (cityEl){
      var rows = D.cityRollup.filter(function(c){ return !state.cities || state.cities.has(c.city); }).filter(function(c){ return c.audits>0; });
      renderGenericTable(cityEl, {
        columns:[
          { key:'city', label:'City' },
          { key:'totalStores', label:'Stores in city' },
          { key:'storesAudited', label:'Stores audited', render:function(r){ return r.storesAudited+' <span style="color:var(--text-faint)">('+pct(r.storesAudited,r.totalStores)+'%)</span>'; } },
          { key:'audits', label:'Audits' },
          { key:'avgScore', label:'Avg score', render:function(r){ return scoreBadge(r.avgScore); } },
          { key:'capaOverdue', label:'CAPA overdue', render:function(r){ return r.capaOverdue>0 ? '<span class="badge bad">'+r.capaOverdue+'</span>' : '<span class="badge good">0</span>'; } },
          { key:'capaClosed', label:'CAPA closed' },
        ],
        rows: rows, pageSize: 12, searchable:true, defaultSort:{key:'capaOverdue', dir:'desc'},
        onRowClick: function(r){ openCityModal(r); }
      });
    }
    var podEl = document.getElementById('podTable');
    if (podEl){
      var prows = D.podRollup.filter(function(p){ return (!state.cities || state.cities.has(p.city)) && (!state.pods || state.pods.has(p.storeId)); });
      renderGenericTable(podEl, {
        columns:[
          { key:'storeName', label:'POD' },
          { key:'city', label:'City' },
          { key:'audits', label:'Audits' },
          { key:'lastAuditDate', label:'Last audited' },
          { key:'lastScore', label:'Last score', render:function(r){ return scoreBadge(r.lastScore); } },
          { key:'capaOverdue', label:'CAPA overdue', render:function(r){ return r.capaOverdue>0 ? '<span class="badge bad">'+r.capaOverdue+'</span>' : '<span class="badge good">0</span>'; } },
          { key:'capaClosed', label:'CAPA closed' },
        ],
        rows: prows, pageSize: 12, searchable:true, defaultSort:{key:'capaOverdue', dir:'desc'},
        onRowClick: function(r){ openPodModal(r); },
        onViewReport: function(r){ openStoreReportModal(r.storeId); }
      });
    }
  }

  function ncByParamRows(ncByParam){
    return Object.keys(ncByParam).map(function(k){
      var v = ncByParam[k]; return { key:k, nc:v.nc, partial:v.partial, total:v.total, rate: pct(v.nc+v.partial, v.total) };
    }).sort(function(a,b){ return b.rate-a.rate; }).filter(function(r){ return r.total>0; });
  }
  function metaFor(key){
    var p = D.categoryStats.parameters.find(function(x){ return x.key===key; });
    return p || { short:key, icon:'note' };
  }

  function openCityModal(r){
    var rows = ncByParamRows(r.ncByParam);
    var body = '<div class="section-sub" style="margin-bottom:10px">'+r.storesAudited+' of '+r.totalStores+' stores audited · '+r.audits+' audits · avg score '+r.avgScore+'%</div>'+
      '<div id="city-modal-bar"></div>';
    openModal('city', r.city+' — parameter breakdown', body);
    var el = document.querySelector('#modalRoot .modal-body #city-modal-bar');
    C.hbar(el, { items: rows.map(function(x){ return { label:metaFor(x.key).short, value:x.rate, color:zoneColor(x.key), key:x.key }; }), max:100, valueFmt:function(v){ return v+'%'; },
      onClick:function(it){ openModal(metaFor(it.key).icon, metaFor(it.key).short+' findings — '+r.city, findingsListHtml(D.drilldown[it.key] ? D.drilldown[it.key].filter(function(x){ return x.city===r.city; }) : [])); } });
  }
  function openPodModal(r){
    var rows = ncByParamRows(r.ncByParam);
    var body = '<div class="section-sub" style="margin-bottom:10px">'+r.city+' · '+r.audits+' audits · last score '+r.lastScore+'% on '+r.lastAuditDate+' · CAPA overdue '+r.capaOverdue+'</div>'+
      '<div id="pod-modal-bar"></div>';
    openModal('store', r.storeName+' — parameter breakdown', body);
    var el = document.querySelector('#modalRoot .modal-body #pod-modal-bar');
    C.hbar(el, { items: rows.map(function(x){ return { label:metaFor(x.key).short, value:x.rate, color:zoneColor(x.key), key:x.key }; }), max:100, valueFmt:function(v){ return v+'%'; },
      onClick:function(it){ openModal(metaFor(it.key).icon, metaFor(it.key).short+' findings — '+r.storeName, findingsListHtml(D.drilldown[it.key] ? D.drilldown[it.key].filter(function(x){ return x.storeId===r.storeId; }) : [])); } });
  }

  // ================================================================
  // SECTION: SKU findings (expiry / FEFO / puffing / location)
  // ================================================================
  function renderSkuFindings(f){
    var kEl = document.getElementById('skuKpis');
    if (kEl){
      var s = D.skuFindings;
      kEl.innerHTML = [
        { key:'expired', value:fmt(s.expired), label:'Expired SKUs found', sub:'across '+fmt(s.total)+' SKU checks' },
        { key:'fefo', value:fmt(s.fefoViolations), label:'FIFO/FEFO violations', sub:'wrong stock rotation' },
        { key:'puffing', value:fmt(s.puffingViolations), label:'Puffed / damaged packs', sub:'flagged for removal' },
        { key:'location', value:fmt(s.locationDeviations), label:'Storage location deviations', sub:'SKUs stored in wrong zone' },
      ].map(C.kpiCard).join('');
    }
    var bEl = document.getElementById('skuByCity');
    if (bEl){
      var mode = state.skuGroupBy;
      var titleEl = document.getElementById('skuByCityTitle');
      var items;
      if (mode==='store'){
        if (titleEl) titleEl.textContent = 'Findings by store';
        items = D.skuFindings.byPod.filter(function(p){ return (!state.cities||state.cities.has(p.city)) && (!state.pods||state.pods.has(p.storeId)); })
          .slice(0, 15).map(function(p){ return { label:p.storeName, value:p.total, color:'var(--z-expiry)' }; });
      } else if (mode==='sku'){
        if (titleEl) titleEl.textContent = 'Top expired SKUs';
        var bySku = {};
        f.skuExpired.forEach(function(r){ var k=r.skuName||'Unknown'; bySku[k]=(bySku[k]||0)+1; });
        items = Object.keys(bySku).map(function(k){ return { label:k, value:bySku[k] }; })
          .sort(function(a,b){ return b.value-a.value; }).slice(0, 15)
          .map(function(r){ return { label:r.label, value:r.value, color:'var(--z-expiry)' }; });
      } else {
        if (titleEl) titleEl.textContent = 'Findings by city';
        items = D.skuFindings.byCity.filter(function(c){ return !state.cities || state.cities.has(c.city); }).slice(0, 15)
          .map(function(c){ return { label:c.city, value:c.total, color:'var(--z-expiry)' }; });
      }
      C.hbar(bEl, { items: items });
    }
    var eEl = document.getElementById('expiredSkuTable');
    if (eEl){
      renderGenericTable(eEl, {
        columns:[
          { key:'city', label:'City' },
          { key:'storeName', label:'POD' },
          { key:'skuName', label:'SKU', wide:true },
          { key:'zone', label:'Zone' },
          { key:'remark', label:'Remark', wide:true },
          { key:'photoUrl', label:'Evidence', render:function(r){ return r.photoUrl ? '<a class="photo-link" href="'+esc(r.photoUrl)+'" target="_blank">'+icon('image',{size:11})+'View</a>' : '—'; } },
        ],
        rows: f.skuExpired, pageSize: 10, searchable:true
      });
    }
  }

  // ================================================================
  // SECTION: store report ("View Report" — text only, no photos)
  // ================================================================
  function initSkuToggle(){
    var seg = document.getElementById('skuGroupSeg'); if (!seg) return;
    seg.addEventListener('click', function(e){
      var btn = e.target.closest('.seg-btn'); if (!btn || !seg.contains(btn)) return;
      seg.querySelectorAll('.seg-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      state.skuGroupBy = btn.getAttribute('data-group');
      renderSkuFindings(computeFiltered());
    });
  }

  function latestAuditForStore(storeId){
    var rows = D.audits.filter(function(a){ return a.storeId===storeId; });
    if (!rows.length) return null;
    return rows.slice().sort(function(a,b){ return b.date.localeCompare(a.date); })[0];
  }
  function reportListHtml(capaRows){
    if (!capaRows.length) return '<div class="empty-state">No CAPA tasks recorded for this store.</div>';
    return capaRows.slice(0, 60).map(function(c){
      var meta = STATE_META[c.slaState] || {};
      return '<div class="finding-card">'+
        '<div class="fc-top"><span class="fc-title">'+esc(c.checkpoint)+'</span><span class="badge '+(meta.tone||'neutral')+'">'+esc(meta.label||c.status)+'</span></div>'+
        '<div class="fc-meta">Audited '+esc(c.auditDate||'')+' · Assigned to '+esc(c.assignedPodEmail||'—')+' · CAPA due '+esc((c.dueAt||'').slice(0,10))+'</div>'+
        (c.remark ? '<div class="fc-remark"><b>Auditor remark:</b> '+esc(c.remark)+'</div>' : '')+
        (c.status==='Closed' ? '<div class="fc-remark"><b>Closure remark:</b> '+esc(c.closureRemark||'—')+' &nbsp; <b>Closed by:</b> '+esc(c.closedBy||'—')+' on '+esc((c.closedAt||'').slice(0,10))+'</div>' : '')+
      '</div>';
    }).join('') + (capaRows.length>60 ? '<div class="section-sub">Showing 60 of '+capaRows.length+' CAPA tasks.</div>' : '');
  }
  function openStoreReportModal(storeId){
    var audit = latestAuditForStore(storeId);
    if (!audit){ openModal('note', 'Report', '<div class="empty-state">No audit found for this store.</div>'); return; }
    var capaRows = D.capa.filter(function(c){ return c.storeId===storeId; }).sort(function(a,b){ return b.auditDate.localeCompare(a.auditDate); });
    var body = '<div class="section-sub" style="margin-bottom:10px">'+esc(audit.city)+' · '+esc(audit.storeName)+' (ID '+esc(audit.storeId)+') · Latest audit '+esc(audit.date)+' · Score '+audit.scorePercent+'% · NC '+audit.nc+' · Partial '+audit.pc+'</div>'+
      '<div class="card-title">'+icon('clipboard-list',{size:15})+'CAPA tasks for this store ('+capaRows.length+')</div>'+
      reportListHtml(capaRows);
    openModal('note', esc(audit.storeName)+' — report', body);
  }

  // ================================================================
  // Generic sortable / searchable / paginated table
  // ================================================================
  function renderGenericTable(el, opts){
    var page = 0;
    var sort = opts.defaultSort || null;
    var search = '';
    function draw(){
      var rows = opts.rows.slice();
      if (search){
        var s = search.toLowerCase();
        rows = rows.filter(function(r){ return opts.columns.some(function(c){ return String(r[c.key]||'').toLowerCase().indexOf(s)>-1; }); });
      }
      if (sort){
        rows.sort(function(a,b){
          var av=a[sort.key], bv=b[sort.key];
          if (typeof av === 'string') return sort.dir==='asc' ? av.localeCompare(bv) : bv.localeCompare(av);
          return sort.dir==='asc' ? av-bv : bv-av;
        });
      }
      var pageSize = opts.pageSize || 10;
      var totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
      page = Math.min(page, totalPages-1);
      var pageRows = rows.slice(page*pageSize, page*pageSize+pageSize);
      var colCount = opts.columns.length + (opts.onViewReport ? 1 : 0);
      var head = opts.columns.map(function(c){ return '<th data-key="'+c.key+'"'+(c.wide?' style="min-width:220px"':'')+'>'+esc(c.label)+(sort&&sort.key===c.key?(sort.dir==='asc'?' ▲':' ▼'):'')+'</th>'; }).join('')+(opts.onViewReport?'<th></th>':'');
      var body = pageRows.length ? pageRows.map(function(r,i){
        return '<tr'+((opts.onRowClick||opts.onViewReport)?' class="rowlink" data-i="'+i+'"':'')+'>'+opts.columns.map(function(c){ return '<td>'+(c.render ? c.render(r) : esc(r[c.key])) +'</td>'; }).join('')+
          (opts.onViewReport ? '<td><button type="button" class="view-report-btn" data-report-btn data-i="'+i+'">'+icon('note',{size:11})+'View report</button></td>' : '')+
        '</tr>';
      }).join('') : ('<tr><td colspan="'+colCount+'"><div class="empty-state">No matching rows.</div></td></tr>');
      el.innerHTML =
        (opts.searchable ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;flex-wrap:wrap;gap:8px">'+
          '<div class="search-box">'+icon('search',{size:14})+'<input type="text" placeholder="Search this table…" value="'+esc(search)+'"/></div>'+
          '<div class="section-sub">'+fmt(rows.length)+' rows</div></div>' : '')+
        '<div class="table-wrap"><table class="datatable"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'+
        '<div class="pager"><span>Page '+(page+1)+' of '+totalPages+'</span><span><button data-act="prev" '+(page===0?'disabled':'')+'>‹ Prev</button> <button data-act="next" '+(page>=totalPages-1?'disabled':'')+'>Next ›</button></span></div>';
      el.querySelectorAll('thead th').forEach(function(th){
        th.addEventListener('click', function(){
          var k = th.getAttribute('data-key');
          sort = (sort && sort.key===k) ? { key:k, dir: sort.dir==='asc'?'desc':'asc' } : { key:k, dir:'desc' };
          draw();
        });
      });
      var input = el.querySelector('.search-box input');
      if (input) input.addEventListener('input', function(){ search = input.value; page = 0; draw(); });
      var pv = el.querySelector('[data-act="prev"]'); if (pv) pv.addEventListener('click', function(){ page--; draw(); });
      var nx = el.querySelector('[data-act="next"]'); if (nx) nx.addEventListener('click', function(){ page++; draw(); });
      if (opts.onRowClick){
        el.querySelectorAll('tbody tr.rowlink').forEach(function(tr){
          tr.addEventListener('click', function(e){
            if (e.target.closest('[data-report-btn]')) return;
            opts.onRowClick(pageRows[+tr.getAttribute('data-i')]);
          });
        });
      }
      if (opts.onViewReport){
        el.querySelectorAll('[data-report-btn]').forEach(function(btn){
          btn.addEventListener('click', function(e){
            e.stopPropagation();
            opts.onViewReport(pageRows[+btn.getAttribute('data-i')]);
          });
        });
      }
    }
    draw();
  }

  // ================================================================
  // Modal
  // ================================================================
  function openModal(iconName, title, bodyHtml){
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-backdrop open"><div class="modal">'+
        '<div class="modal-head"><h3>'+icon(iconName,{size:18})+esc(title)+'</h3><button class="modal-close">'+icon('x',{size:14})+'</button></div>'+
        '<div class="modal-body">'+bodyHtml+'</div>'+
      '</div></div>';
    root.querySelector('.modal-close').addEventListener('click', closeModal);
    root.querySelector('.modal-backdrop').addEventListener('click', function(e){ if (e.target === this) closeModal(); });
  }
  function closeModal(){ var root = document.getElementById('modalRoot'); if (root) root.innerHTML=''; }

  // ================================================================
  // Filter bar UI
  // ================================================================
  function multiSelect(opts){
    // opts: {btnId, label, options:[{id,label}], getSelected():Set|null, onChange(Set|null)}
    // getSelected always re-reads the authoritative state, so two multiSelect
    // widgets bound to the same underlying state (e.g. City filters duplicated
    // on the POD Audits tab and the CAPA tab) stay visually in sync no matter
    // which one the user last touched.
    var btn = document.getElementById(opts.btnId); if (!btn) return null;
    var wrap = btn.closest('.msel');
    var pop = wrap.querySelector('.msel-pop');
    var searchVal = '';
    function current(){ return opts.getSelected ? opts.getSelected() : opts.selected; }
    function renderPop(){
      var q = searchVal.toLowerCase();
      var sel = current();
      var opts2 = opts.options.filter(function(o){ return o.label.toLowerCase().indexOf(q) > -1; }).slice(0, 300);
      pop.innerHTML =
        '<input class="msel-search" placeholder="Search…" value="'+esc(searchVal)+'"/>'+
        '<div class="msel-actions"><button data-act="all">Select all</button><button data-act="none">Clear</button></div>'+
        opts2.map(function(o){
          var checked = !sel || sel.has(o.id);
          return '<label class="msel-opt"><input type="checkbox" data-id="'+esc(o.id)+'" '+(checked?'checked':'')+'/> '+esc(o.label)+'</label>';
        }).join('');
      pop.querySelector('.msel-search').addEventListener('input', function(e){ searchVal = e.target.value; renderPop(); });
      pop.querySelector('[data-act="all"]').addEventListener('click', function(){ opts.onChange(null); updateBtn(); renderPop(); });
      pop.querySelector('[data-act="none"]').addEventListener('click', function(){ opts.onChange(new Set()); updateBtn(); renderPop(); });
      pop.querySelectorAll('input[type=checkbox]').forEach(function(cb){
        cb.addEventListener('change', function(){
          var next = current();
          next = next ? new Set(next) : new Set(opts.options.map(function(o){ return o.id; }));
          if (cb.checked) next.add(cb.getAttribute('data-id')); else next.delete(cb.getAttribute('data-id'));
          if (next.size === opts.options.length) next = null;
          opts.onChange(next); updateBtn();
        });
      });
    }
    function updateBtn(){
      var sel = current();
      var n = sel ? sel.size : opts.options.length;
      btn.innerHTML = icon('chevron-down',{size:12})+' '+opts.label+(sel ? ' <span class="count">'+n+'</span>' : ' <span class="count">All</span>');
    }
    btn.addEventListener('click', function(e){ e.stopPropagation(); var wasOpen = wrap.classList.contains('open'); document.querySelectorAll('.msel.open').forEach(function(w){ w.classList.remove('open'); }); if (!wasOpen){ wrap.classList.add('open'); renderPop(); } });
    document.addEventListener('click', function(e){ if (!wrap.contains(e.target)) wrap.classList.remove('open'); });
    updateBtn();
    return { updateBtn: updateBtn };
  }

  function renderActiveTags(){
    var el = document.getElementById('activeTags'); if (!el) return;
    var tags = [];
    if (state.cities) tags.push({ t:'City: '+state.cities.size+' selected', clear:function(){ state.cities=null; refreshAll(); } });
    if (state.pods) tags.push({ t:'POD: '+state.pods.size+' selected', clear:function(){ state.pods=null; refreshAll(); } });
    if (state.dateFrom !== D.meta.dateRange.from || state.dateTo !== D.meta.dateRange.to) tags.push({ t:state.dateFrom+' → '+state.dateTo, clear:function(){ state.dateFrom=D.meta.dateRange.from; state.dateTo=D.meta.dateRange.to; syncDateInputs(); refreshAll(); } });
    el.innerHTML = tags.map(function(t,i){ return '<span class="tag" data-i="'+i+'">'+esc(t.t)+'<button>'+icon('x',{size:10})+'</button></span>'; }).join('');
    el.querySelectorAll('.tag button').forEach(function(b,i){ b.addEventListener('click', function(){ tags[i].clear(); }); });
  }
  function syncDateInputs(){
    var f = document.getElementById('dateFrom'), t = document.getElementById('dateTo');
    if (f) f.value = state.dateFrom; if (t) t.value = state.dateTo;
  }

  var msWidgets = [];
  function initFilterBar(){
    msWidgets.push(multiSelect({ btnId:'citySelBtn', label:'City', options: ALL_CITIES.map(function(c){ return {id:c,label:c}; }), getSelected:function(){ return state.cities; }, onChange:function(v){ state.cities=v; state.pods=null; refreshAll(); } }));
    msWidgets.push(multiSelect({ btnId:'podSelBtn', label:'POD', options: ALL_PODS.map(function(p){ return {id:p.id,label:p.label}; }), getSelected:function(){ return state.pods; }, onChange:function(v){ state.pods=v; refreshAll(); } }));
    // CAPA tab has its own duplicate City/POD filters (same shared state) plus a Cluster filter — present only on pod-audits.html.
    msWidgets.push(multiSelect({ btnId:'citySelBtnCapa', label:'City', options: ALL_CITIES.map(function(c){ return {id:c,label:c}; }), getSelected:function(){ return state.cities; }, onChange:function(v){ state.cities=v; refreshAll(); } }));
    msWidgets.push(multiSelect({ btnId:'podSelBtnCapa', label:'POD', options: ALL_PODS.map(function(p){ return {id:p.id,label:p.label}; }), getSelected:function(){ return state.pods; }, onChange:function(v){ state.pods=v; refreshAll(); } }));
    msWidgets.push(multiSelect({ btnId:'clusterSelBtnCapa', label:'Cluster', options: ALL_CLUSTERS.map(function(c){ return {id:c,label:c}; }), getSelected:function(){ return state.clusters; }, onChange:function(v){ state.clusters=v; refreshAll(); } }));
    var f = document.getElementById('dateFrom'), t = document.getElementById('dateTo');
    if (f){ f.min = D.meta.dateRange.from; f.max = D.meta.dateRange.to; f.value = state.dateFrom; f.addEventListener('change', function(){ state.dateFrom = f.value; refreshAll(); }); }
    if (t){ t.min = D.meta.dateRange.from; t.max = D.meta.dateRange.to; t.value = state.dateTo; t.addEventListener('change', function(){ state.dateTo = t.value; refreshAll(); }); }
    var reset = document.getElementById('resetFiltersBtn');
    if (reset) reset.addEventListener('click', function(){ state.cities=null; state.pods=null; state.dateFrom=D.meta.dateRange.from; state.dateTo=D.meta.dateRange.to; syncDateInputs(); refreshAll(); });
  }

  // ================================================================
  // theme toggle
  // ================================================================
  function initTheme(){
    var saved = localStorage.getItem('pac-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    var btn = document.getElementById('themeToggle');
    if (btn){
      function paint(){ var cur = document.documentElement.getAttribute('data-theme') || 'light'; btn.innerHTML = icon(cur==='dark'?'sun':'moon',{size:16}); }
      btn.addEventListener('click', function(){
        var cur = document.documentElement.getAttribute('data-theme') || 'light';
        var next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('pac-theme', next);
        paint();
      });
      paint();
    }
  }

  // ================================================================
  // master refresh
  // ================================================================
  function refreshAll(){
    var f = computeFiltered();
    msWidgets.forEach(function(w){ if (w) w.updateBtn(); });
    renderActiveTags();
    renderKPIs(f);
    renderPodsAudited(f);
    renderCapaSla(f);
    renderCategoryCompliance();
    renderCityPodTables(f);
    renderSkuFindings(f);
    if (global.onDashboardRefresh) global.onDashboardRefresh(f);
  }

  function init(){
    initTheme();
    initFilterBar();
    initCadenceToggle();
    initSkuToggle();
    refreshAll();
  }

  global.Dashboard = { init:init, refreshAll:refreshAll, state:state, openModal:openModal, closeModal:closeModal, esc:esc, computeFiltered:computeFiltered, zoneCards:zoneNonCompliantCards, categoryCards:categoryNonCompliantCards, categoryTabs:CATEGORY_TABS, openStoreReport:openStoreReportModal, openCapaList:openCapaListModal };
})(window);
