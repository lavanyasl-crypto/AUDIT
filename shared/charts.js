/* ============================================================
   Shared chart-rendering module — hand-rolled SVG/CSS, zero
   external chart library, zero network dependency.
   All functions take a container element + options and set
   .innerHTML; interactive bits are wired via event delegation
   so callers pass onClick/onHover callbacks.
   ============================================================ */
(function(global){
  "use strict";

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function fmt(n){ n = n||0; return n.toLocaleString('en-IN'); }
  function pct(n,d){ return d ? Math.round((n/d)*1000)/10 : 0; }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  var PALETTE = ['#fc8019','#1d4ed8','#0d9488','#c0271b','#7c3aed','#0891b2','#b45309','#15803d','#db2777','#64748b'];

  // -------- tooltip (single shared floating element) --------
  var ttEl = null;
  function ensureTT(){
    if (!ttEl){ ttEl = document.createElement('div'); ttEl.className = 'tooltip'; document.body.appendChild(ttEl); }
    return ttEl;
  }
  function showTT(html, evt){
    var el = ensureTT(); el.innerHTML = html; el.classList.add('show');
    var x = evt.clientX + 16, y = evt.clientY + 16;
    var w = 260, h = 120;
    if (x + w > window.innerWidth) x = evt.clientX - w - 12;
    if (y + h > window.innerHeight) y = evt.clientY - h - 12;
    el.style.left = x+'px'; el.style.top = y+'px';
  }
  function hideTT(){ if (ttEl) ttEl.classList.remove('show'); }

  // -------- KPI card --------
  // Plain style on purpose: no icon, no trend chip — just a label and a big number.
  function kpiCard(o){
    return (
      '<div class="kpi" data-kpi="'+esc(o.key||'')+'">'+
        '<div class="kpi-label">'+esc(o.label)+'</div>'+
        '<div class="kpi-value">'+esc(o.value)+'</div>'+
        (o.sub ? '<div class="kpi-sub">'+o.sub+'</div>' : '')+
      '</div>'
    );
  }

  // -------- donut chart --------
  // segments: [{label, value, color}]
  function donut(el, opts){
    var segs = (opts.segments||[]).filter(function(s){ return s.value > 0; });
    var total = segs.reduce(function(a,s){ return a+s.value; }, 0);
    var size = opts.size || 176, thick = opts.thickness || 24;
    var r = size/2 - thick/2, C = 2*Math.PI*r, cx = size/2, cy = size/2;
    var offset = 0, arcs = '';
    segs.forEach(function(s, i){
      var frac = total ? s.value/total : 0;
      var len = frac * C;
      var dash = len+' '+(C-len);
      var rot = (offset/C)*360 - 90;
      arcs += '<circle class="donut-seg" data-idx="'+i+'" cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+s.color+'" stroke-width="'+thick+'" stroke-dasharray="'+dash+'" transform="rotate('+rot+' '+cx+' '+cy+')" style="cursor:'+(opts.onClick?'pointer':'default')+'"/>';
      offset += len;
    });
    var svg = '<svg viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'">'+arcs+'</svg>';
    var center = '<div class="donut-center" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none">'+
        '<div style="font-family:var(--font-head);font-size:'+(size>150?26:20)+'px;font-weight:800;line-height:1">'+esc(opts.centerValue!=null?opts.centerValue:fmt(total))+'</div>'+
        '<div style="font-size:10.5px;color:var(--text-faint);font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-top:3px">'+esc(opts.centerLabel||'Total')+'</div>'+
      '</div>';
    var legend = '<div class="chart-legend">' + segs.map(function(s,i){
      return '<div class="li" data-idx="'+i+'" style="'+(opts.onClick?'cursor:pointer':'')+'"><span class="sw" style="background:'+s.color+'"></span>'+esc(s.label)+' <b class="mono" style="color:var(--text)">'+fmt(s.value)+'</b> <span style="color:var(--text-faint)">('+pct(s.value,total)+'%)</span></div>';
    }).join('') + '</div>';
    el.innerHTML = '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">'+
        '<div style="position:relative;width:'+size+'px;height:'+size+'px;flex-shrink:0">'+svg+center+'</div>'+
        '<div style="flex:1;min-width:160px">'+legend+'</div>'+
      '</div>';
    if (opts.onClick){
      el.querySelectorAll('[data-idx]').forEach(function(node){
        node.addEventListener('click', function(){ opts.onClick(segs[+node.getAttribute('data-idx')]); });
      });
    }
    if (opts.onHover){
      el.querySelectorAll('.donut-seg').forEach(function(node){
        node.addEventListener('mousemove', function(e){ opts.onHover(segs[+node.getAttribute('data-idx')], e); });
        node.addEventListener('mouseleave', hideTT);
      });
    }
  }

  // -------- horizontal bar leaderboard --------
  // items: [{label, value, sub, color}]
  function hbar(el, opts){
    var items = opts.items || [];
    var max = opts.max || Math.max.apply(null, items.map(function(i){ return i.value; }).concat([1]));
    el.innerHTML = items.map(function(it, i){
      var w = clamp(pct(it.value, max), it.value>0?2:0, 100);
      return '<div class="bar-row" data-idx="'+i+'">'+
        '<span class="lbl" title="'+esc(it.label)+'">'+esc(it.label)+'</span>'+
        '<span class="bar-track"><span class="bar-fill" style="width:'+w+'%;background:'+(it.color||'var(--accent)')+'"></span></span>'+
        '<span class="bar-val mono">'+(opts.valueFmt ? opts.valueFmt(it.value) : fmt(it.value))+'</span>'+
      '</div>';
    }).join('') || '<div class="empty-state">No data for the current filters.</div>';
    if (opts.onClick){
      el.querySelectorAll('.bar-row .lbl').forEach(function(node, i){
        node.addEventListener('click', function(){ opts.onClick(items[i]); });
      });
    }
  }

  // -------- vertical bar / line chart on a shared SVG axis --------
  // points: [{x:label, y:number}]
  function lineArea(el, opts){
    var pts = opts.points || [];
    var w = opts.width || el.clientWidth || 640, h = opts.height || 190;
    var padL = 34, padB = 26, padT = 14, padR = 10;
    var iw = w - padL - padR, ih = h - padT - padB;
    var maxY = opts.maxY || Math.max.apply(null, pts.map(function(p){ return p.y; }).concat([1])) * 1.15;
    var stepX = pts.length > 1 ? iw/(pts.length-1) : iw;
    var xy = pts.map(function(p,i){ return [padL + i*stepX, padT + ih - (p.y/maxY)*ih]; });
    var linePath = xy.map(function(p,i){ return (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1); }).join(' ');
    var areaPath = linePath + ' L'+xy[xy.length-1][0].toFixed(1)+','+(padT+ih)+' L'+xy[0][0].toFixed(1)+','+(padT+ih)+' Z';
    var gridLines = '', yTicks = 4;
    for (var g=0; g<=yTicks; g++){
      var gy = padT + ih - (g/yTicks)*ih;
      gridLines += '<line x1="'+padL+'" y1="'+gy+'" x2="'+(w-padR)+'" y2="'+gy+'" stroke="var(--border)" stroke-width="1"/>';
      gridLines += '<text x="'+(padL-8)+'" y="'+(gy+3)+'" font-size="9.5" fill="var(--text-faint)" text-anchor="end">'+fmt(Math.round(maxY*g/yTicks))+'</text>';
    }
    var xLabels = xy.map(function(p,i){
      if (pts.length > 14 && i % Math.ceil(pts.length/10) !== 0) return '';
      return '<text x="'+p[0].toFixed(1)+'" y="'+(h-6)+'" font-size="9.5" fill="var(--text-faint)" text-anchor="middle">'+esc(pts[i].x)+'</text>';
    }).join('');
    var dots = xy.map(function(p,i){
      return '<circle class="ln-dot" data-idx="'+i+'" cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3.2" fill="'+(opts.color||'var(--accent)')+'" stroke="var(--surface)" stroke-width="1.5" style="cursor:pointer"/>';
    }).join('');
    var gradId = 'grad'+Math.random().toString(36).slice(2,8);
    el.innerHTML = '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" preserveAspectRatio="none">'+
      '<defs><linearGradient id="'+gradId+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+(opts.color||'#fc8019')+'" stop-opacity="0.32"/><stop offset="100%" stop-color="'+(opts.color||'#fc8019')+'" stop-opacity="0.02"/></linearGradient></defs>'+
      gridLines+
      '<path d="'+areaPath+'" fill="url(#'+gradId+')" stroke="none"/>'+
      '<path d="'+linePath+'" fill="none" stroke="'+(opts.color||'var(--accent)')+'" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>'+
      dots + xLabels +
      '</svg>';
    if (opts.onHover){
      el.querySelectorAll('.ln-dot').forEach(function(node){
        node.addEventListener('mousemove', function(e){ opts.onHover(pts[+node.getAttribute('data-idx')], e); });
        node.addEventListener('mouseleave', hideTT);
      });
    }
    if (opts.onClick){
      el.querySelectorAll('.ln-dot').forEach(function(node){
        node.addEventListener('click', function(){ opts.onClick(pts[+node.getAttribute('data-idx')]); });
      });
    }
  }

  // -------- stacked bar chart --------
  // categories: [{label, segments:[{value,color,label}]}]
  function stackedBar(el, opts){
    var cats = opts.categories || [];
    var w = opts.width || el.clientWidth || 640, h = opts.height || 210;
    var padL = 8, padB = 40, padT = 10, padR = 8;
    var iw = w - padL - padR, ih = h - padT - padB;
    var totals = cats.map(function(c){ return c.segments.reduce(function(a,s){ return a+s.value; },0); });
    var maxT = Math.max.apply(null, totals.concat([1]));
    var n = cats.length || 1;
    var gap = Math.min(18, iw/n*0.35);
    var bw = (iw/n) - gap;
    var bars = cats.map(function(c, i){
      var x = padL + i*(iw/n) + gap/2;
      var total = totals[i];
      var yCursor = padT + ih;
      var rects = c.segments.map(function(s){
        var segH = maxT ? (s.value/maxT)*ih : 0;
        yCursor -= segH;
        return '<rect data-cat="'+i+'" x="'+x.toFixed(1)+'" y="'+yCursor.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+segH.toFixed(1)+'" fill="'+s.color+'" rx="2"><title>'+esc(s.label)+': '+fmt(s.value)+'</title></rect>';
      }).join('');
      var label = '<text x="'+(x+bw/2).toFixed(1)+'" y="'+(h-10)+'" font-size="10" fill="var(--text-soft)" text-anchor="middle">'+esc(c.label.length>12?c.label.slice(0,11)+'…':c.label)+'</text>';
      return rects+label;
    }).join('');
    el.innerHTML = '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" preserveAspectRatio="xMidYMid meet">'+bars+'</svg>';
    if (opts.onClick){
      el.querySelectorAll('rect').forEach(function(node){
        node.addEventListener('click', function(){ opts.onClick(cats[+node.getAttribute('data-cat')]); });
      });
    }
    if (opts.onHover){
      el.querySelectorAll('rect').forEach(function(node){
        node.addEventListener('mousemove', function(e){ opts.onHover(cats[+node.getAttribute('data-cat')], e); });
        node.addEventListener('mouseleave', hideTT);
      });
    }
  }

  // -------- heatmap grid --------
  // rows: [label...], cols: [label...], value(rowLabel,colLabel) -> {v, n, d} v=0..100 severity pct, n=count
  function heatmap(el, opts){
    var rows = opts.rows || [], cols = opts.cols || [];
    var cellData = opts.cellData; // function(r,c) -> {pct, count, tone}
    var colorFor = opts.colorFor || function(pct){
      if (pct == null) return 'var(--bg-soft)';
      if (pct >= 40) return 'var(--bad)';
      if (pct >= 20) return 'var(--warn)';
      if (pct > 0) return '#eab308';
      return 'var(--good)';
    };
    var html = '<div class="table-wrap"><table class="datatable" style="min-width:'+(140+cols.length*92)+'px"><thead><tr><th class="sticky-col">City / POD</th>';
    cols.forEach(function(c){ html += '<th style="text-align:center">'+esc(c)+'</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function(r, ri){
      html += '<tr><td class="sticky-col" style="font-weight:700">'+esc(r)+'</td>';
      cols.forEach(function(c, ci){
        var d = cellData(r, c, ri, ci) || {};
        var bg = colorFor(d.pct);
        var txt = d.pct==null ? '—' : (d.pct+'%');
        var fg = d.pct==null ? 'var(--text-faint)' : '#fff';
        html += '<td style="padding:4px"><div class="hm-cell" data-r="'+ri+'" data-c="'+ci+'" style="background:'+bg+';color:'+fg+'">'+txt+'</div></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
    if (opts.onClick){
      el.querySelectorAll('.hm-cell').forEach(function(node){
        node.addEventListener('click', function(){ opts.onClick(rows[+node.getAttribute('data-r')], cols[+node.getAttribute('data-c')]); });
      });
    }
    if (opts.onHover){
      el.querySelectorAll('.hm-cell').forEach(function(node){
        node.addEventListener('mousemove', function(e){ opts.onHover(rows[+node.getAttribute('data-r')], cols[+node.getAttribute('data-c')], e); });
        node.addEventListener('mouseleave', hideTT);
      });
    }
  }

  global.Charts = {
    esc: esc, fmt: fmt, pct: pct, PALETTE: PALETTE,
    showTT: showTT, hideTT: hideTT,
    kpiCard: kpiCard, donut: donut, hbar: hbar, lineArea: lineArea, stackedBar: stackedBar, heatmap: heatmap
  };
})(window);
