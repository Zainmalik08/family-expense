(function () {
'use strict';

var cfg = window.LEDGER_CONFIG || {};
var app = document.getElementById('app');
var CACHE_KEY = 'ledger-cache-v1';
var DEFAULT_CATS = ['Doctor appointments', 'Hospital bill', 'Hospital & emergency', 'Medicines', 'Lab tests', 'Treatment', 'Supplies', 'Transport', 'Other'];
var TABS = ['overview', 'expenses', 'money'];

var data = { title: "Mother's Treatment Expenses", updated: null, expenses: [], moneyIn: [], paybacks: [] };
var loaded = false, offline = false, isAdmin = false, session = null, sb = null, lastLoad = 0;
var filters = { q: '', cat: '', src: '' };
var deferredInstall = null;
var tab = TABS.indexOf(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : 'overview';

/* ---------- helpers ---------- */
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function money(n) { var v = Math.round(num(n)); return (v < 0 ? '−Rs ' : 'Rs ') + Math.abs(v).toLocaleString('en-US'); }
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function today() { return ymd(new Date()); }
function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }
function parseDay(s) { if (!s) return null; var d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; }
function fmtDay(s) { var d = parseDay(s); return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
function dayLabel(s) {
  if (!s) return 'Date not recorded';
  if (s === today()) return 'Today';
  if (s === daysAgo(1)) return 'Yesterday';
  var d = parseDay(s); if (!d) return 'Date not recorded';
  var o = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('en-GB', o);
}
function fmtStamp(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
function key(n) { return String(n || '').trim().toLowerCase(); }
function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }
function uniq(a) { var s = {}, o = []; a.forEach(function (x) { var k = key(x); if (k && !s[k]) { s[k] = 1; o.push(x); } }); return o; }
function byDateDesc(field) { return function (a, b) { return String(b[field] || '').localeCompare(String(a[field] || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')); }; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

var toastTimer = null;
function toast(msg) {
  var t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
}

/* ---------- totals ---------- */
function compute() {
  var total = 0, cats = {}, map = {}, cashIn = 0, cashOut = 0, paidBackCash = 0, toReceive = 0, returned = 0;
  var tKey = today(), wKey = daysAgo(6), todaySpent = 0, weekSpent = 0, first = '', undated = 0;
  function P(n) { var k = key(n); if (!map[k]) map[k] = { name: String(n).trim(), owed: 0, gave: 0, returned: 0, pending: 0 }; return map[k]; }
  data.expenses.forEach(function (e) {
    var a = num(e.amount); total += a;
    var c = e.category || 'Other'; cats[c] = (cats[c] || 0) + a;
    if (!e.spent_on) undated++; else { if (e.spent_on === tKey) todaySpent += a; if (e.spent_on >= wKey) weekSpent += a; if (!first || e.spent_on < first) first = e.spent_on; }
    if (e.source === 'cash') cashOut += a;
    else if (e.source === 'person' && key(e.paid_by)) { var p = P(e.paid_by); if (e.pay_back) p.owed += a; else p.gave += a; }
  });
  data.moneyIn.forEach(function (m) {
    var a = num(m.amount); var p = P(m.from_name || 'Unknown');
    if (!m.received) { p.pending += a; toReceive += a; return; }
    cashIn += a;
    if (m.returnable) p.owed += a; else p.gave += a;
  });
  data.paybacks.forEach(function (b) { var a = num(b.amount); P(b.to_name || 'Unknown').returned += a; returned += a; if (b.from_cash) paidBackCash += a; });
  var people = Object.keys(map).map(function (k) { var p = map[k]; p.left = p.owed - p.returned; return p; });
  people.sort(function (a, b) { return (b.left - a.left) || (b.pending - a.pending) || (b.gave - a.gave) || a.name.localeCompare(b.name); });
  var owing = people.filter(function (p) { return p.left > 0.5; });
  var due = owing.reduce(function (s, p) { return s + p.left; }, 0);
  var givers = people.filter(function (p) { return p.gave > 0; }).length;
  return { total: total, cats: cats, people: people, owing: owing, cashIn: cashIn, cashOut: cashOut, paidBackCash: paidBackCash, cash: cashIn - cashOut - paidBackCash,
    due: due, toReceive: toReceive, returned: returned, todaySpent: todaySpent, weekSpent: weekSpent, first: first, undated: undated, givers: givers };
}
function canonicalName(n) {
  n = String(n || '').trim(); if (!n) return '';
  var found = compute().people.filter(function (p) { return key(p.name) === key(n); })[0];
  return found ? found.name : n;
}

/* ---------- data ---------- */
function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: data, at: Date.now() })); } catch (e) {} }
function readCache() {
  try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c && c.data) { data = c.data; return true; } } catch (e) {}
  return false;
}
function load() {
  lastLoad = Date.now();
  return Promise.all([
    sb.from('settings').select('title,updated_at').eq('id', 1).maybeSingle(),
    sb.from('expenses').select('*'),
    sb.from('money_in').select('*'),
    sb.from('paybacks').select('*')
  ]).then(function (r) {
    var err = r.map(function (x) { return x.error; }).filter(Boolean)[0];
    if (err) throw err;
    data = {
      title: (r[0].data && r[0].data.title) || data.title,
      updated: r[0].data && r[0].data.updated_at,
      expenses: r[1].data || [], moneyIn: r[2].data || [], paybacks: r[3].data || []
    };
    loaded = true; offline = false; saveCache(); render();
  }).catch(function (e) {
    console.error(e);
    if (readCache()) { loaded = true; offline = true; render(); }
    else {
      app.innerHTML = '<header class="top"><div class="top-main"><h1>Could not load the figures</h1><p class="sub">Check your internet connection and try again.</p></div></header><p><button type="button" class="primary" data-act="reload">Try again</button></p>';
    }
  });
}

/* ---------- pieces ---------- */
function sourceText(e) {
  if (e.source === 'cash') return 'Cash in hand';
  if (e.source === 'family') return 'Family money';
  if (e.paid_by) return 'Paid by ' + h(e.paid_by) + (e.pay_back ? '<span class="tag">pay back</span>' : '');
  return 'Someone’s own money';
}
function expenseRow(e, meta) {
  var tag = isAdmin ? 'button' : 'div';
  return '<li><' + tag + (isAdmin ? ' type="button"' : '') + ' class="row" data-act="edit-expense" data-id="' + h(e.id) + '">'
    + '<span class="r-main"><span class="r-title">' + h(e.description) + '</span><span class="r-meta">' + meta + '</span></span>'
    + '<span class="r-amt">' + money(e.amount) + '</span></' + tag + '></li>';
}
function tile(cls, label, value, hint, goTo) {
  return '<button type="button" class="tile ' + cls + '" data-act="tab" data-tab="' + goTo + '"><span class="label">' + label + '</span><span class="val">' + value + '</span><span class="hint">' + hint + '</span></button>';
}
function categoryList(c, limit) {
  var cats = Object.keys(c.cats).map(function (k) { return [k, c.cats[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  if (!cats.length) return '<p class="empty">Spending by category appears here once expenses are added.</p>';
  var max = cats[0][1] || 1;
  return '<ul class="cats card">' + cats.slice(0, limit || cats.length).map(function (x) {
    var share = c.total > 0 ? Math.round(x[1] / c.total * 100) : 0;
    return '<li><button type="button" class="cat" data-act="filter-cat" data-cat="' + h(x[0]) + '" aria-label="Show ' + h(x[0]) + ' expenses"><span class="cat-top"><span>' + h(x[0]) + '</span><span class="num">' + money(x[1]) + '<em>' + share + '%</em></span></span><span class="bar"><span style="width:' + Math.max(1, x[1] / max * 100).toFixed(1) + '%"></span></span></button></li>';
  }).join('') + '</ul>';
}
function personCard(p, full) {
  var out = '<div class="owe"><span class="owe-name">' + h(p.name) + '</span>';
  if (p.left > 0.5) out += '<span class="owe-amt">' + money(p.left) + '</span>';
  else if (p.owed > 0) out += '<span class="owe-amt ok">Settled</span>';
  else if (p.pending > 0) out += '<span class="owe-amt">To give ' + money(p.pending) + '</span>';
  else out += '<span class="owe-amt ok">' + money(p.gave) + '</span>';
  var bits = [];
  if (p.owed > 0) bits.push('Paid for us ' + money(p.owed) + ' · returned ' + money(p.returned));
  if (full && p.gave > 0) bits.push('Gave ' + money(p.gave) + ', no return needed');
  if (full && p.pending > 0 && !(p.left <= 0.5 && p.owed <= 0)) bits.push('Still to give ' + money(p.pending));
  if (bits.length) out += '<span class="owe-detail">' + bits.join('<br>') + '</span>';
  if (p.owed > 0) { var pct = Math.min(100, p.returned / p.owed * 100); out += '<span class="meter" role="img" aria-label="' + Math.round(pct) + '% paid back"><span style="width:' + pct.toFixed(1) + '%"></span></span>'; }
  if (isAdmin && p.left > 0.5) out += '<button type="button" class="link-btn" data-act="payback" data-name="' + h(p.name) + '">Record payback</button>';
  return out + '</div>';
}

/* ---------- views ---------- */
function header() {
  return '<header class="top"><div class="top-main"><h1>' + h(data.title) + '</h1><p class="sub">' + (data.updated ? 'Updated ' + h(fmtStamp(data.updated)) : 'Nothing recorded yet') + '</p></div>'
    + '<div class="top-side">' + (isAdmin ? '<span class="badge">Admin</span>' : '') + '<button type="button" class="ghost" data-act="copy">Share</button></div></header>'
    + (offline ? '<p class="banner">You are offline. These are the last figures this phone saw.</p>' : '');
}

function overview(c) {
  var n = data.expenses.length;
  var html = '<section class="hero" aria-label="Total spent"><span class="hero-label">Total spent so far</span><span class="hero-num">' + money(c.total) + '</span>'
    + '<span class="hero-meta">' + plural(n, 'expense', 'expenses') + (c.first && !c.undated ? ' · since ' + h(fmtDay(c.first)) : '') + '</span>'
    + '<div class="hero-row"><div><span>Today</span><b>' + money(c.todaySpent) + '</b></div><div><span>Last 7 days</span><b>' + money(c.weekSpent) + '</b></div></div></section>';

  html += '<section class="tiles" aria-label="Quick figures">'
    + tile('cash', 'Cash in hand', money(c.cash), 'Money left to spend', 'money')
    + tile('due', 'We still owe', money(c.due), c.owing.length ? 'To ' + plural(c.owing.length, 'person', 'people') : 'Nobody right now', 'money')
    + tile('', 'Money received', money(c.cashIn), c.toReceive ? money(c.toReceive) + ' still to come' : 'Cash given for treatment', 'money')
    + tile('', 'Paid back', money(c.returned), 'Returned to people', 'money')
    + '</section>';

  html += '<section class="sec" aria-labelledby="h-owe"><div class="sec-head"><h2 id="h-owe">Who we need to pay back</h2></div>';
  if (c.owing.length) html += '<div class="card">' + c.owing.map(function (p) { return personCard(p, false); }).join('') + '</div>';
  else html += '<p class="empty">Nobody needs to be paid back right now.</p>';
  var settled = c.people.filter(function (p) { return p.owed > 0 && p.left <= 0.5; }).map(function (p) { return h(p.name); });
  var pend = c.people.filter(function (p) { return p.pending > 0; }).map(function (p) { return h(p.name) + ' ' + money(p.pending); });
  if (settled.length) html += '<p class="note">Fully paid back: ' + settled.join(', ') + '</p>';
  if (pend.length) html += '<p class="note">Still to give to the budget: ' + pend.join(', ') + '</p>';
  html += '</section>';

  var catCount = Object.keys(c.cats).length;
  html += '<section class="sec" aria-labelledby="h-cats"><div class="sec-head"><h2 id="h-cats">Where the money went</h2></div>' + categoryList(c, 5)
    + (catCount > 5 ? '<button type="button" class="more" data-act="tab" data-tab="expenses">See all ' + catCount + ' categories →</button>' : '') + '</section>';

  var recent = data.expenses.slice().sort(byDateDesc('spent_on')).slice(0, 6);
  html += '<section class="sec" aria-labelledby="h-recent"><div class="sec-head"><h2 id="h-recent">Latest spending</h2></div>';
  if (recent.length) {
    html += '<ul class="rows card">' + recent.map(function (e) { return expenseRow(e, h(dayLabel(e.spent_on)) + ' · ' + h(e.category || 'Other')); }).join('') + '</ul>';
    if (n > recent.length) html += '<button type="button" class="more" data-act="tab" data-tab="expenses">See all ' + n + ' expenses →</button>';
  } else html += '<p class="empty">No expenses yet.' + (isAdmin ? ' Tap <b>+ Add</b> to record the first one.' : '') + '</p>';
  html += '</section>';
  return html;
}

function expensesView(c) {
  var html = '<section class="sec" aria-labelledby="h-all"><div class="sec-head"><h2 id="h-all">All expenses</h2><span class="label">' + plural(data.expenses.length, 'expense', 'expenses') + ' · ' + money(c.total) + '</span></div>';
  if (data.expenses.length) {
    var catOpts = uniq(Object.keys(c.cats).sort(function (a, b) { return c.cats[b] - c.cats[a]; }));
    html += '<div class="filters"><input id="f-q" type="search" placeholder="Search expenses" aria-label="Search expenses" value="' + h(filters.q) + '">'
      + '<select id="f-cat" aria-label="Filter by category"><option value="">All categories</option>' + catOpts.map(function (x) { return '<option value="' + h(x) + '"' + (x === filters.cat ? ' selected' : '') + '>' + h(x) + '</option>'; }).join('') + '</select>'
      + '<select id="f-src" aria-label="Filter by how it was paid"><option value="">Paid any way</option>'
      + [['cash', 'Cash in hand'], ['person', 'Someone’s own money'], ['family', 'Family money']].map(function (o) { return '<option value="' + o[0] + '"' + (filters.src === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
      + '</select></div>';
  }
  html += '<div id="entry-list"></div></section>';
  html += '<section class="sec" aria-labelledby="h-cats2"><div class="sec-head"><h2 id="h-cats2">By category</h2></div>' + categoryList(c) + '</section>';
  return html;
}

function moneyView(c) {
  var html = '<section class="sec" aria-labelledby="h-cash"><div class="sec-head"><h2 id="h-cash">Cash in hand</h2></div><div class="card lines">'
    + '<div class="line"><span>Money received</span><span>' + money(c.cashIn) + '</span></div>'
    + '<div class="line"><span>Spent from cash</span><span>' + money(-c.cashOut) + '</span></div>'
    + (c.paidBackCash ? '<div class="line"><span>Paid back from cash</span><span>' + money(-c.paidBackCash) + '</span></div>' : '')
    + '<div class="line total"><span>Cash in hand now</span><span>' + money(c.cash) + '</span></div>'
    + (c.toReceive ? '<div class="line"><span>Still to receive</span><span>' + money(c.toReceive) + '</span></div>' : '')
    + '</div></section>';

  var everyone = c.people.filter(function (p) { return p.owed > 0 || p.gave > 0 || p.pending > 0 || p.returned > 0; });
  html += '<section class="sec" aria-labelledby="h-people"><div class="sec-head"><h2 id="h-people">Everyone who helped</h2></div>';
  html += everyone.length ? '<div class="card">' + everyone.map(function (p) { return personCard(p, true); }).join('') + '</div>' : '<p class="empty">Nobody has paid or given money yet.</p>';
  html += '</section>';

  html += '<section class="sec" aria-labelledby="h-in"><div class="sec-head"><h2 id="h-in">Money received</h2><span class="label">' + money(c.cashIn) + '</span></div>';
  if (data.moneyIn.length) {
    html += '<ul class="rows card">' + data.moneyIn.slice().sort(byDateDesc('received_on')).map(function (m) {
      var tag = isAdmin ? 'button' : 'div';
      var tags = (m.received ? '' : '<span class="tag">still to receive</span>') + (m.returnable ? '<span class="tag">to return</span>' : '');
      return '<li><' + tag + (isAdmin ? ' type="button"' : '') + ' class="row" data-act="edit-in" data-id="' + h(m.id) + '"><span class="r-main"><span class="r-title">From ' + h(m.from_name) + tags + '</span>'
        + '<span class="r-meta">' + h(dayLabel(m.received_on)) + (m.note ? ' · ' + h(m.note) : '') + '</span></span><span class="r-amt in">+' + money(m.amount) + '</span></' + tag + '></li>';
    }).join('') + '</ul>';
  } else html += '<p class="empty">No money received yet.</p>';
  html += '</section>';

  html += '<section class="sec" aria-labelledby="h-rep"><div class="sec-head"><h2 id="h-rep">Money paid back</h2><span class="label">' + money(c.returned) + '</span></div>';
  if (data.paybacks.length) {
    html += '<ul class="rows card">' + data.paybacks.slice().sort(byDateDesc('paid_on')).map(function (b) {
      var tag = isAdmin ? 'button' : 'div';
      return '<li><' + tag + (isAdmin ? ' type="button"' : '') + ' class="row" data-act="edit-payback" data-id="' + h(b.id) + '"><span class="r-main"><span class="r-title">Returned to ' + h(b.to_name) + '</span>'
        + '<span class="r-meta">' + h(dayLabel(b.paid_on)) + (b.note ? ' · ' + h(b.note) : '') + '</span></span><span class="r-amt">' + money(b.amount) + '</span></' + tag + '></li>';
    }).join('') + '</ul>';
  } else html += '<p class="empty">Nothing paid back yet.</p>';
  html += '</section>';
  return html;
}

function footer() {
  return '<footer class="foot"><p>To keep this on your phone, open the link in Chrome or Safari and choose <b>Add to Home Screen</b>.</p>'
    + '<div class="foot-actions">' + (deferredInstall ? '<button type="button" class="link-btn" data-act="install">Install app</button>' : '')
    + '<button type="button" class="link-btn" data-act="reload">Refresh</button>'
    + (isAdmin ? '<button type="button" class="link-btn" data-act="settings">Rename</button><button type="button" class="link-btn" data-act="logout">Sign out</button>'
               : (session ? '<button type="button" class="link-btn" data-act="logout">Sign out</button>' : '<button type="button" class="link-btn" data-act="login">Admin sign in</button>'))
    + '</div></footer>';
}

function render() {
  if (!loaded) return;
  var c = compute();
  document.title = data.title;
  var html = header() + (tab === 'expenses' ? expensesView(c) : tab === 'money' ? moneyView(c) : overview(c)) + footer();
  var focused = document.activeElement && document.activeElement.id === 'f-q';
  app.innerHTML = html;
  if (focused) { var q = document.getElementById('f-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  renderEntries();
  renderChrome();
}

function matches(e) {
  if (filters.cat && (e.category || 'Other') !== filters.cat) return false;
  if (filters.src && e.source !== filters.src) return false;
  if (filters.q) { var q = key(filters.q); if ((key(e.description) + ' ' + key(e.category) + ' ' + key(e.paid_by)).indexOf(q) < 0) return false; }
  return true;
}
function renderEntries() {
  var box = document.getElementById('entry-list'); if (!box) return;
  if (!data.expenses.length) { box.innerHTML = '<p class="empty">No expenses recorded yet.</p>'; return; }
  var list = data.expenses.filter(matches).sort(byDateDesc('spent_on'));
  var shownTotal = list.reduce(function (s, e) { return s + num(e.amount); }, 0);
  var out = '';
  if (filters.q || filters.cat || filters.src) out += '<p class="result-line">Showing ' + list.length + ' of ' + data.expenses.length + ' · ' + money(shownTotal) + ' · <button type="button" class="link-btn" data-act="clear-filters">Clear filters</button></p>';
  if (!list.length) { box.innerHTML = out + '<p class="empty">No expenses match this search.</p>'; return; }
  var groups = [], idx = {};
  list.forEach(function (e) {
    var k = e.spent_on || 'none';
    if (!(k in idx)) { idx[k] = groups.length; groups.push({ k: k, items: [], sum: 0 }); }
    var g = groups[idx[k]]; g.items.push(e); g.sum += num(e.amount);
  });
  out += '<div class="card">' + groups.map(function (g) {
    return '<div class="day"><span>' + h(dayLabel(g.k === 'none' ? '' : g.k)) + '</span><span class="num">' + money(g.sum) + '</span></div><ul class="rows">'
      + g.items.map(function (e) { return expenseRow(e, h(e.category || 'Other') + ' · ' + sourceText(e)); }).join('') + '</ul>';
  }).join('') + '</div>';
  box.innerHTML = out;
}

/* ---------- tab bar + add button ---------- */
var ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  expenses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14.5" r="1.2"/></svg>'
};
var nav = document.createElement('nav'); nav.className = 'tabbar'; nav.setAttribute('aria-label', 'Sections'); document.body.appendChild(nav);
var fab = document.createElement('button'); fab.type = 'button'; fab.className = 'fab'; fab.setAttribute('data-act', 'add-menu'); fab.textContent = '+ Add'; fab.hidden = true; document.body.appendChild(fab);
function renderChrome() {
  nav.innerHTML = '<div class="tabbar-in">' + [['overview', 'Overview'], ['expenses', 'Expenses'], ['money', 'Money']].map(function (t) {
    return '<button type="button" class="tab" data-act="tab" data-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + ICONS[t[0]] + '<span>' + t[1] + '</span></button>';
  }).join('') + '</div>';
  fab.hidden = !isAdmin;
}
function setTab(t) {
  if (TABS.indexOf(t) < 0) t = 'overview';
  if (location.hash.slice(1) !== t) { location.hash = t; return; } // hashchange renders
  tab = t; render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', function () {
  var t = location.hash.slice(1); tab = TABS.indexOf(t) >= 0 ? t : 'overview'; render(); window.scrollTo(0, 0);
});
function openAddMenu() {
  openSheet('<div class="form"><h2 id="sheet-title">What do you want to add?</h2><div class="choices">'
    + '<button type="button" class="choice" data-act="add-expense"><b>Expense</b><span>Money spent on treatment</span></button>'
    + '<button type="button" class="choice" data-act="add-in"><b>Money received</b><span>Cash someone gave for the treatment</span></button>'
    + '<button type="button" class="choice" data-act="payback"><b>Payback</b><span>Money returned to someone</span></button>'
    + '</div><div class="actions"><span class="spacer"></span><button type="button" class="secondary" data-act="close">Cancel</button></div></div>');
}

/* ---------- sheet ---------- */
var sheet = document.createElement('div'); sheet.className = 'sheet-wrap'; sheet.hidden = true;
sheet.innerHTML = '<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div id="sheet-body"></div></div>';
document.body.appendChild(sheet);
var lastFocus = null;
function openSheet(inner, focusId) {
  lastFocus = document.activeElement;
  document.getElementById('sheet-body').innerHTML = inner; sheet.hidden = false;
  var f = focusId && document.getElementById(focusId); if (f) setTimeout(function () { f.focus(); }, 40);
}
function closeSheet() {
  if (sheet.hidden) return; sheet.hidden = true; document.getElementById('sheet-body').innerHTML = '';
  if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
}
function field(id, label, control, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label>' + control + (hint ? '<p class="hint" id="' + id + '-hint">' + hint + '</p>' : '') + '</div>'; }
function input(id, value, attrs) { return '<input id="' + id + '" autocomplete="off" value="' + h(value) + '" ' + (attrs || '') + '>'; }
function datalists() {
  var c = compute();
  return '<datalist id="dl-cats">' + uniq(DEFAULT_CATS.concat(Object.keys(c.cats))).map(function (x) { return '<option value="' + h(x) + '"></option>'; }).join('') + '</datalist>'
    + '<datalist id="dl-people">' + c.people.map(function (p) { return '<option value="' + h(p.name) + '"></option>'; }).join('') + '</datalist>';
}
function actions(isEdit, delAct, id, saveLabel) {
  return '<p class="err" id="form-err" hidden></p><div class="actions">' + (isEdit ? '<button type="button" class="danger" data-act="' + delAct + '" data-id="' + h(id) + '">Delete</button>' : '')
    + '<span class="spacer"></span><button type="button" class="secondary" data-act="close">Cancel</button><button type="submit" class="primary" id="form-save">' + saveLabel + '</button></div>';
}
function formError(msg) { var el = document.getElementById('form-err'); if (el) { el.textContent = msg; el.hidden = false; } }
function busy(on) { var b = document.getElementById('form-save'); if (b) { b.disabled = on; if (on) { b.dataset.label = b.textContent; b.textContent = 'Saving…'; } else if (b.dataset.label) b.textContent = b.dataset.label; } }

function openExpense(id) {
  var e = id ? data.expenses.filter(function (x) { return x.id === id; })[0] : null;
  var v = e || { spent_on: today(), description: '', amount: '', category: '', source: 'cash', paid_by: '', pay_back: true };
  var src = v.source || 'cash';
  openSheet('<form id="expense-form" class="form" data-id="' + h(id || '') + '" novalidate><h2 id="sheet-title">' + (e ? 'Edit expense' : 'Add expense') + '</h2>'
    + field('x-desc', 'What was it for?', input('x-desc', v.description, 'placeholder="e.g. MRI scan, doctor visit, medicines"'))
    + '<div class="row2">' + field('x-amt', 'Amount (Rs)', input('x-amt', v.amount, 'type="number" inputmode="decimal" min="0" step="any" placeholder="0"'))
    + field('x-date', 'Date', input('x-date', v.spent_on || '', 'type="date"')) + '</div>'
    + field('x-cat', 'Category', input('x-cat', v.category, 'list="dl-cats" placeholder="Choose or type a new one"'))
    + '<fieldset><legend class="legend">Paid from</legend><div class="seg">'
    + [['cash', 'Cash in hand'], ['person', 'Someone’s own money'], ['family', 'Family money']].map(function (o) { return '<label><input type="radio" name="x-src" value="' + o[0] + '"' + (src === o[0] ? ' checked' : '') + '>' + o[1] + '</label>'; }).join('')
    + '</div></fieldset>'
    + '<div id="x-person"' + (src === 'person' ? '' : ' hidden') + ' class="form">'
    + field('x-who', 'Who paid?', input('x-who', v.paid_by || '', 'list="dl-people" placeholder="Name"'))
    + '<label class="check" for="x-back"><input type="checkbox" id="x-back"' + ((e ? e.pay_back : true) ? ' checked' : '') + '><span>We need to pay this back to them</span></label></div>'
    + actions(!!e, 'del-expense', id, e ? 'Save changes' : 'Add expense') + datalists() + '</form>', 'x-desc');
}
function submitExpense(form) {
  var id = form.getAttribute('data-id');
  var srcEl = form.querySelector('input[name="x-src"]:checked'); var src = srcEl ? srcEl.value : 'cash';
  var rec = {
    description: val('x-desc').trim(), amount: parseFloat(val('x-amt')), spent_on: val('x-date') || null,
    category: val('x-cat').trim() || 'Other', source: src,
    paid_by: src === 'person' ? canonicalName(val('x-who')) : null,
    pay_back: src === 'person' ? checked('x-back') : false
  };
  if (!rec.description) return formError('Add a short description, like “Medicines from pharmacy”.');
  if (!(rec.amount > 0)) return formError('Enter the amount in rupees.');
  if (src === 'person' && !rec.paid_by) return formError('Write the name of the person who paid.');
  write('expenses', id, rec, id ? 'Expense updated' : 'Expense added');
}

function openMoneyIn(id) {
  var m = id ? data.moneyIn.filter(function (x) { return x.id === id; })[0] : null;
  var v = m || { from_name: '', amount: '', received_on: today(), note: '', returnable: false, received: true };
  openSheet('<form id="in-form" class="form" data-id="' + h(id || '') + '" novalidate><h2 id="sheet-title">' + (m ? 'Edit money received' : 'Money received') + '</h2>'
    + '<p class="hint">Cash someone gave for the treatment. It adds to cash in hand.</p>'
    + field('i-from', 'From', input('i-from', v.from_name, 'list="dl-people" placeholder="Name"'))
    + '<div class="row2">' + field('i-amt', 'Amount (Rs)', input('i-amt', v.amount, 'type="number" inputmode="decimal" min="0" step="any" placeholder="0"'))
    + field('i-date', 'Date', input('i-date', v.received_on || '', 'type="date"')) + '</div>'
    + field('i-note', 'Note (optional)', input('i-note', v.note || '', 'placeholder="e.g. Cash for hospital bill"'))
    + '<label class="check" for="i-ret"><input type="checkbox" id="i-ret"' + (v.returnable ? ' checked' : '') + '><span>We need to return this money to them</span></label>'
    + '<label class="check" for="i-pending"><input type="checkbox" id="i-pending"' + (v.received ? '' : ' checked') + '><span>Not received yet (they still have to give it)</span></label>'
    + actions(!!m, 'del-in', id, m ? 'Save changes' : 'Add') + datalists() + '</form>', 'i-from');
}
function submitMoneyIn(form) {
  var id = form.getAttribute('data-id');
  var rec = { from_name: canonicalName(val('i-from')), amount: parseFloat(val('i-amt')), received_on: val('i-date') || null, note: val('i-note').trim() || null, returnable: checked('i-ret'), received: !checked('i-pending') };
  if (!rec.from_name) return formError('Write who gave the money.');
  if (!(rec.amount > 0)) return formError('Enter the amount in rupees.');
  write('money_in', id, rec, id ? 'Updated' : 'Money received added');
}

function openPayback(id, name) {
  var b = id ? data.paybacks.filter(function (x) { return x.id === id; })[0] : null;
  var v = b || { to_name: name || '', amount: '', paid_on: today(), note: '', from_cash: true };
  if (!b && name) { var p = compute().people.filter(function (p) { return key(p.name) === key(name); })[0]; if (p && p.left > 0) v.amount = Math.round(p.left); }
  openSheet('<form id="payback-form" class="form" data-id="' + h(id || '') + '" novalidate><h2 id="sheet-title">' + (b ? 'Edit payback' : 'Record money paid back') + '</h2>'
    + field('p-to', 'Paid back to', input('p-to', v.to_name, 'list="dl-people" placeholder="Name"'), ' ')
    + '<div class="row2">' + field('p-amt', 'Amount (Rs)', input('p-amt', v.amount, 'type="number" inputmode="decimal" min="0" step="any" placeholder="0"'))
    + field('p-date', 'Date', input('p-date', v.paid_on || '', 'type="date"')) + '</div>'
    + field('p-note', 'Note (optional)', input('p-note', v.note || '', 'placeholder="e.g. Bank transfer"'))
    + '<label class="check" for="p-cash"><input type="checkbox" id="p-cash"' + (v.from_cash ? ' checked' : '') + '><span>Paid from cash in hand</span></label>'
    + actions(!!b, 'del-payback', id, b ? 'Save changes' : 'Record payback') + datalists() + '</form>', v.to_name ? 'p-amt' : 'p-to');
  paybackHint();
}
function paybackHint() {
  var el = document.getElementById('p-to-hint'); if (!el) return;
  var n = key(val('p-to')); var p = n && compute().people.filter(function (p) { return key(p.name) === n; })[0];
  el.textContent = p && p.owed > 0 ? (p.left > 0.5 ? 'Still owed to ' + p.name + ': ' + money(p.left) : p.name + ' is fully paid back.') : '';
}
function submitPayback(form) {
  var id = form.getAttribute('data-id');
  var rec = { to_name: canonicalName(val('p-to')), amount: parseFloat(val('p-amt')), paid_on: val('p-date') || null, note: val('p-note').trim() || null, from_cash: checked('p-cash') };
  if (!rec.to_name) return formError('Write who the money was returned to.');
  if (!(rec.amount > 0)) return formError('Enter the amount in rupees.');
  write('paybacks', id, rec, id ? 'Payback updated' : 'Payback recorded');
}

function openSettings() {
  openSheet('<form id="settings-form" class="form" novalidate><h2 id="sheet-title">Rename this ledger</h2>'
    + field('s-title', 'Name everyone sees', input('s-title', data.title))
    + actions(false, '', '', 'Save name') + '</form>', 's-title');
}
function openLogin() {
  openSheet('<form id="login-form" class="form" novalidate><h2 id="sheet-title">Admin sign in</h2>'
    + '<p class="hint">Only the admin can add or change entries. Everyone else can view without signing in.</p>'
    + field('l-email', 'Email', '<input id="l-email" type="email" autocomplete="username" inputmode="email">')
    + field('l-pass', 'Password', '<input id="l-pass" type="password" autocomplete="current-password">')
    + actions(false, '', '', 'Sign in') + '</form>', 'l-email');
}

function write(table, id, rec, okMsg) {
  busy(true);
  var q = id ? sb.from(table).update(rec).eq('id', id).select() : sb.from(table).insert(rec).select();
  q.then(function (r) {
    busy(false);
    if (r.error) return formError(niceError(r.error));
    if (!r.data || !r.data.length) return formError('Not saved. Your account is not allowed to make changes.');
    closeSheet(); toast(okMsg); load();
  }, function () { busy(false); formError('Not saved. Check your internet connection and try again.'); });
}
function remove(table, id, okMsg) {
  sb.from(table).delete().eq('id', id).select().then(function (r) {
    if (r.error) return formError(niceError(r.error));
    if (!r.data || !r.data.length) return formError('Not deleted. Your account is not allowed to make changes.');
    closeSheet(); toast(okMsg); load();
  }, function () { formError('Not deleted. Check your internet connection and try again.'); });
}
function niceError(err) {
  var m = (err && err.message) || '';
  if (/row-level security|permission denied/i.test(m)) return 'Not saved. Your account is not allowed to make changes.';
  if (/JWT|token/i.test(m)) return 'Your sign-in expired. Sign out and sign in again.';
  return 'Not saved: ' + m;
}

/* ---------- copy summary ---------- */
function summaryText() {
  var c = compute();
  var lines = [data.title, 'Total spent: ' + money(c.total), 'Cash in hand: ' + money(c.cash), ''];
  var owe = c.people.filter(function (p) { return p.left > 0.5; });
  if (owe.length) { lines.push('We need to pay back:'); owe.forEach(function (p) { lines.push('- ' + p.name + ': ' + money(p.left)); }); }
  else lines.push('Nobody needs to be paid back right now.');
  var pend = c.people.filter(function (p) { return p.pending > 0; });
  if (pend.length) { lines.push('', 'Still to receive:'); pend.forEach(function (p) { lines.push('- ' + p.name + ': ' + money(p.pending)); }); }
  var cats = Object.keys(c.cats).sort(function (a, b) { return c.cats[b] - c.cats[a]; });
  if (cats.length) { lines.push('', 'By category:'); cats.forEach(function (k) { lines.push('- ' + k + ': ' + money(c.cats[k])); }); }
  lines.push('', location.href.split('#')[0]);
  return lines.join('\n');
}
function copySummary() {
  var text = summaryText();
  function fallback() {
    openSheet('<div class="form"><h2 id="sheet-title">Copy summary</h2><p class="hint">Select the text below and copy it.</p><textarea id="copy-text" rows="12" readonly>' + h(text) + '</textarea><div class="actions"><span class="spacer"></span><button type="button" class="primary" data-act="close">Done</button></div></div>');
    var t = document.getElementById('copy-text'); if (t) { t.focus(); t.select(); }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Summary copied. Paste it in WhatsApp or anywhere.'); }, fallback);
    else fallback();
  } catch (e) { fallback(); }
}


/* ---------- events ---------- */
function armDelete(btn, fn) {
  if (btn.getAttribute('data-armed')) { fn(); return; }
  btn.setAttribute('data-armed', '1'); btn.textContent = 'Tap again to delete';
  setTimeout(function () { if (document.contains(btn)) { btn.removeAttribute('data-armed'); btn.textContent = 'Delete'; } }, 4000);
}
document.addEventListener('click', function (ev) {
  var t = ev.target.closest && ev.target.closest('[data-act]'); if (!t) return;
  var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
  if (act === 'close') return closeSheet();
  if (act === 'tab') return setTab(t.getAttribute('data-tab'));
  if (act === 'reload') return load();
  if (act === 'copy') return copySummary();
  if (act === 'login') return openLogin();
  if (act === 'logout') { sb.auth.signOut().then(function () { toast('Signed out'); }); return; }
  if (act === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(function () { deferredInstall = null; render(); }); return; }
  if (act === 'clear-filters') { filters = { q: '', cat: '', src: '' }; render(); return; }
  if (act === 'filter-cat') { filters = { q: '', cat: t.getAttribute('data-cat') || '', src: '' }; setTab('expenses'); if (tab === 'expenses') render(); return; }
  if (!isAdmin) return;
  if (act === 'add-menu') openAddMenu();
  else if (act === 'add-expense') openExpense(null);
  else if (act === 'edit-expense') openExpense(id);
  else if (act === 'add-in') openMoneyIn(null);
  else if (act === 'edit-in') openMoneyIn(id);
  else if (act === 'payback') openPayback(null, t.getAttribute('data-name') || '');
  else if (act === 'edit-payback') openPayback(id);
  else if (act === 'settings') openSettings();
  else if (act === 'del-expense') armDelete(t, function () { remove('expenses', id, 'Expense deleted'); });
  else if (act === 'del-in') armDelete(t, function () { remove('money_in', id, 'Deleted'); });
  else if (act === 'del-payback') armDelete(t, function () { remove('paybacks', id, 'Payback deleted'); });
});
document.addEventListener('input', function (ev) {
  var id = ev.target.id;
  if (id === 'f-q') { filters.q = ev.target.value; renderEntries(); }
  else if (id === 'p-to') paybackHint();
});
document.addEventListener('change', function (ev) {
  var t = ev.target;
  if (t.id === 'f-cat') { filters.cat = t.value; renderEntries(); }
  else if (t.id === 'f-src') { filters.src = t.value; renderEntries(); }
  else if (t.name === 'x-src') { var box = document.getElementById('x-person'); if (box) box.hidden = t.value !== 'person'; }
});
document.addEventListener('submit', function (ev) {
  var f = ev.target; ev.preventDefault();
  if (f.id === 'login-form') {
    var email = val('l-email').trim(), pass = val('l-pass');
    if (!email || !pass) return formError('Enter your email and password.');
    busy(true);
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      busy(false);
      if (r.error) return formError('Sign in failed. Check the email and password.');
      closeSheet(); toast('Signed in');
    }, function () { busy(false); formError('Sign in failed. Check your internet connection.'); });
    return;
  }
  if (!isAdmin) return;
  if (f.id === 'expense-form') submitExpense(f);
  else if (f.id === 'in-form') submitMoneyIn(f);
  else if (f.id === 'payback-form') submitPayback(f);
  else if (f.id === 'settings-form') {
    var title = val('s-title').trim(); if (!title) return formError('Give the ledger a name.');
    busy(true);
    sb.from('settings').upsert({ id: 1, title: title }).select().then(function (r) {
      busy(false);
      if (r.error || !r.data || !r.data.length) return formError(r.error ? niceError(r.error) : 'Not saved.');
      closeSheet(); toast('Name saved'); load();
    });
  }
});
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !sheet.hidden) closeSheet(); });
document.addEventListener('visibilitychange', function () { if (sb && document.visibilityState === 'visible' && Date.now() - lastLoad > 30000) load(); });
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; render(); });

/* ---------- start ---------- */
var configured = /^https:\/\//.test(cfg.supabaseUrl || '') && cfg.supabaseKey && String(cfg.supabaseKey).indexOf('PASTE') < 0;
if (!configured || !window.supabase) {
  app.innerHTML = '<header class="top"><div class="top-main"><h1>Almost ready</h1><p class="sub">The database connection is not set yet. Add the Supabase project URL and key in config.js.</p></div></header>';
  return;
}
sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
if (readCache()) { loaded = true; render(); }
load();
sb.auth.onAuthStateChange(function (event, s) {
  session = s;
  // defer: calling Supabase inside this callback can stall the client
  setTimeout(function () {
    if (!session) { isAdmin = false; render(); return; }
    sb.rpc('is_admin').then(function (r) { isAdmin = !r.error && r.data === true; render(); }, function () { isAdmin = false; render(); });
  }, 0);
});
})();
