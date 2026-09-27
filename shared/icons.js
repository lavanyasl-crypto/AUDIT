/* ============================================================
   Shared inline SVG icon set — 24x24 viewBox, stroke-based,
   one distinct glyph per concept (cadence, zone, CAPA state...).
   Usage: icon('calendar-day', {cls:'ic'})  -> full <svg> string
   ============================================================ */
(function(global){
  "use strict";

  var ICONS = {
    logo: '<path d="M9 12.5l2 2 4.5-5"/><path d="M4 5.5l8-3 8 3v6c0 5-3.5 8.2-8 9.7C7.5 19.7 4 16.5 4 11.5v-6z"/>',

    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',

    'calendar-day': '<rect x="3.5" y="5" width="17" height="16" rx="2.4"/><path d="M8 3v4M16 3v4M3.5 10h17"/><circle cx="12" cy="15.3" r="2.1" fill="currentColor" stroke="none"/>',
    'calendar-week': '<rect x="3.5" y="5" width="17" height="16" rx="2.4"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M7.3 15.3h9.4" stroke-width="2.4"/>',
    'calendar-month': '<rect x="3.5" y="5" width="17" height="16" rx="2.4"/><path d="M8 3v4M16 3v4M3.5 10h17"/><rect x="6.6" y="12.6" width="3.3" height="3.3" rx="0.7" fill="currentColor" stroke="none"/><rect x="10.7" y="12.6" width="3.3" height="3.3" rx="0.7" fill="currentColor" stroke="none" opacity=".45"/><rect x="14.8" y="12.6" width="3.3" height="3.3" rx="0.7" fill="currentColor" stroke="none" opacity=".45"/>',

    store: '<path d="M4 9.5l1-5h14l1 5"/><path d="M4 9.5a2.6 2.6 0 0 0 5.1.5A2.6 2.6 0 0 0 12 9.5a2.6 2.6 0 0 0 5.1.5 2.6 2.6 0 0 0 5-.5"/><path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5.5h3.5a1 1 0 0 0 1-1V10"/>',
    city: '<path d="M4 21V9l6-4v16M4 21h16M10 21V5l6 4v12M13 9h2M13 12.3h2M13 15.6h2M6.5 12.3h1M6.5 15.6h1M6.5 18.8h1"/>',
    map: '<path d="M9 5.2L4 7v13l5-1.8 6 1.8 5-1.8V4l-5 1.8-6-1.8z"/><path d="M9 5.2v13M15 6.8v13"/>',
    pin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.4" r="2.4"/>',

    clipboard: '<rect x="5.5" y="4.5" width="13" height="17" rx="2.2"/><path d="M9 4.5V3.3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V4.5"/><path d="M8.4 11.5l2 2 4-4.4M8.4 17h6.8"/>',
    'clipboard-list': '<rect x="5.5" y="4.5" width="13" height="17" rx="2.2"/><path d="M9 4.5V3.3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V4.5"/><path d="M8.5 11h7M8.5 14.3h7M8.5 17.6h4.3"/>',

    'check-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.4 2.4 5-5.5"/>',
    'alert-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.4"/><circle cx="12" cy="16.3" r=".9" fill="currentColor" stroke="none"/>',
    'clock-progress': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.6 2"/>',
    'flame-overdue': '<path d="M12 21c4 0 6.5-2.6 6.5-6.2 0-2.7-1.5-4.5-2.6-6-.3 1.7-1.2 2.6-2 2.1.4-2.8-.6-5.3-2.6-6.9-.4 3-1.9 4.7-3.6 6.6C6.1 12.2 5.5 13.9 5.5 15.4 5.5 18.7 8 21 12 21z"/>',
    'shield-check': '<path d="M12 3l7 3v5.5c0 5-3 8-7 9.5-4-1.5-7-4.5-7-9.5V6z"/><path d="M9 12l2.1 2.1L15.3 10"/>',
    hourglass: '<path d="M6.5 3h11M6.5 21h11M7.5 3c0 4.5 2 6 4.5 7-2.5 1-4.5 2.5-4.5 7M16.5 3c0 4.5-2 6-4.5 7 2.5 1 4.5 2.5 4.5 7"/>',

    thermo: '<path d="M12 3.5a2 2 0 0 0-2 2v9.4a4 4 0 1 0 4 0V5.5a2 2 0 0 0-2-2z"/><path d="M12 9.5v6.4"/>',
    chiller: '<path d="M12 2.5v19M4.5 7l15 10M19.5 7l-15 10"/><path d="M12 2.5l-1.8 1.8M12 2.5l1.8 1.8M12 21.5l-1.8-1.8M12 21.5l1.8-1.8M4.5 7l2.4.3M4.5 7l.6-2.3M19.5 7l-2.4.3M19.5 7l-.6-2.3M4.5 17l2.4-.3M4.5 17l.6 2.3M19.5 17l-2.4-.3M19.5 17l-.6 2.3"/>',
    freezer: '<path d="M12 2.5v19M4.5 7l15 10M19.5 7l-15 10M4.5 17l15-10"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
    acroom: '<path d="M3 9.5h11.5a2.6 2.6 0 1 0-2.3-3.8M3 14.2h14a2.6 2.6 0 1 1-2.3 3.8M3 12h9.5a2.2 2.2 0 1 1-1.9 3.3"/>',
    inward: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M9 12h7M13 8.8L16.2 12 13 15.2"/>',

    trash: '<path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M7 7l1 12.2a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8L17 7"/><path d="M10.3 11v6M13.7 11v6"/>',
    leaf: '<path d="M4 20c0-8.5 5.5-14.5 15-15-1 9-6.5 15-15 15z"/><path d="M6.5 17.5c2-2.7 4-5 8.7-9.3"/>',

    stack: '<path d="M12 3.5l8 4.2-8 4.2-8-4.2z"/><path d="M4 12l8 4.2 8-4.2M4 15.8l8 4.2 8-4.2"/>',
    location: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>',
    box: '<path d="M3.5 8l8.5-4.5L20.5 8v8L12 20.5 3.5 16z"/><path d="M3.5 8L12 12.3 20.5 8M12 12.3V20.5"/>',
    note: '<path d="M6 3.5h9l3.5 3.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z"/><path d="M15 3.5V7h3.5M8 11h8M8 14.3h8M8 17.6h5"/>',
    barcode: '<path d="M4 5v14M8 5v14M11 5v14M13.5 5v14M17 5v14M20 5v14"/>',
    recycle: '<path d="M10 3.5l2.7 4.6h-5.4zM9.3 8.1L6.5 12.8M17.3 20.5l-2.7-4.6h5.4zM18 15.9l2.8-4.7M6.7 20.5H14l-2.3-4"/>',
    'package-alert': '<path d="M3.5 8l8.5-4.5L20.5 8v8L12 20.5 3.5 16z"/><path d="M3.5 8L12 12.3 20.5 8M12 12.3V20.5"/><circle cx="12" cy="6.3" r=".2" fill="none"/>',

    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M20 20l-4.4-4.4"/>',
    filter: '<path d="M4 5h16M7 12h10M10.3 19h3.4"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    'chevron-down': '<path d="M5.5 8.5l6.5 6.5 6.5-6.5"/>',
    refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5L19 8.3M19.5 12a7.5 7.5 0 0 1-12.6 5.5L5 15.7M4.5 5.5v3.5H8M20 18.5V15H16.5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17.5l5-5 3 3 4-4.5 4.5 5"/>',
    link: '<path d="M9.5 14.5l5-5M8.3 17.2l-2 2a3.2 3.2 0 0 1-4.5-4.5l3-3a3.2 3.2 0 0 1 4.5 0M15.7 6.8l2-2a3.2 3.2 0 0 1 4.5 4.5l-3 3a3.2 3.2 0 0 1-4.5 0"/>',
    download: '<path d="M12 3.5v11.5M8 11.5l4 4 4-4M4.5 17v2.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V17"/>',
    'trend-up': '<path d="M4 16l6-6 4 4 6-7"/><path d="M15 6.5h5V11.5"/>',
    'trend-down': '<path d="M4 8l6 6 4-4 6 7"/><path d="M15 17.5h5V12.5"/>',
    percent: '<circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/><path d="M18 6L6 18"/>',
    grid: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.4"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.4"/>',
    list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
    layers: '<path d="M12 3.5l8 4.5-8 4.5-8-4.5z"/><path d="M4 12.5l8 4.5 8-4.5"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2l-1.8 4.3-4.3 1.8 1.8-4.3z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.3"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.3 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.3-3.5-8.5S9.7 5.8 12 3.5z"/>',
    users: '<circle cx="9" cy="8.3" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M15.2 5.6a3 3 0 0 1 0 5.7M18.5 19c0-2.5-1.6-4.4-3.8-4.9"/>'
  };

  function icon(name, opts){
    opts = opts || {};
    var body = ICONS[name] || ICONS.info;
    var cls = opts.cls || 'ic';
    var size = opts.size ? (' width="'+opts.size+'" height="'+opts.size+'"') : '';
    var style = opts.style ? (' style="'+opts.style+'"') : '';
    return '<svg class="'+cls+'"'+size+style+' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+body+'</svg>';
  }

  global.ICONS = ICONS;
  global.icon = icon;
})(window);
