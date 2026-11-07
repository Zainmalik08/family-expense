(function () {
'use strict';

var cfg = window.LEDGER_CONFIG || {};
var app = document.getElementById('app');
var CACHE_KEY = 'ledger-cache-v1';
var DEFAULT_CATS = ['Hospital bill', 'Medicines', 'Doctor & treatment', 'Lab tests', 'Transport', 'Other'];
var TABS = ['overview', 'days', 'money'];

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
function fmtDay(s) { var d = parseDay(s); return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''; }
function dayLabel(s) {
  if (!s) return 'Date not recorded';
  if (s === today()) return 'Today';
  if (s === daysAgo(1)) return 'Yesterday';
  var d = parseDay(s); if (!d) return 'Date not recorded';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function longDay(s) {
  var d = parseDay(s); if (!d) return 'Date not recorded';
  var full = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (s === today()) return 'Today · ' + full;
  if (s === daysAgo(1)) return 'Yesterday · ' + full;
  return full;
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
  var total = 0, cats = {}, map = {}, cashIn = 0, cashOut = 0, ownPocket = 0, paidBackCash = 0, toReceive = 0, returned = 0;
  var tKey = today(), todaySpent = 0, first = '', last = '';
  function P(n) { var k = key(n); if (!map[k]) map[k] = { name: String(n).trim(), owed: 0, gave: 0, returned: 0, pending: 0 }; return map[k]; }
  data.expenses.forEach(function (e) {
    var a = num(e.amount); total += a;
    var c = e.category || 'Other'; cats[c] = (cats[c] || 0) + a;
    if (e.spent_on) { if (e.spent_on === tKey) todaySpent += a; if (!first || e.spent_on < first) first = e.spent_on; if (!last || e.spent_on > last) last = e.spent_on; }
    if (e.source === 'cash') cashOut += a;
    else { ownPocket += a; if (e.source === 'person' && key(e.paid_by)) { var p = P(e.paid_by); if (e.pay_back) p.owed += a; else p.gave += a; } }
  });
  data.moneyIn.forEach(function (m) {
    var a = num(m.amount); var p = P(m.from_name || 'Unknown');
    if (!m.received) { p.pending += a; toReceive += a; return; }
    cashIn += a;
    if (m.returnable) p.owed += a; else p.gave += a;
  });
  data.paybacks.forEach(function (b) { var a = num(b.amount); P(b.to_name || 'Unknown').returned += a; returned += a; if (b.from_cash) paidBackCash += a; });
  var people = Object.keys(map).map(function (k) { var p = map[k]; p.left = p.owed - p.returned; return p; });
  people.sort(function (a, b) { return (b.left - a.left) || (b.owed - a.owed) || (b.gave - a.gave) || a.name.localeCompare(b.name); });
  var owing = people.filter(function (p) { return p.left > 0.5; });
  var due = owing.reduce(function (s, p) { return s + p.left; }, 0);
  return { total: total, cats: cats, people: people, owing: owing, cashIn: cashIn, cashOut: cashOut, ownPocket: ownPocket, paidBackCash: paidBackCash,
    cash: cashIn - cashOut - paidBackCash, due: due, toReceive: toReceive, returned: returned, todaySpent: todaySpent, first: first, last: last };
}
function canonicalName(n) {
  n = String(n || '').trim(); if (!n) return '';
  var found = compute().people.filter(function (p) { return key(p.name) === key(n); })[0];
  return found ? found.name : n;
}

/* day-by-day story: money in first, then paybacks, then spending, in the order entered */
function timeline() {
  var ev = [];
  data.moneyIn.forEach(function (m) { if (m.received) ev.push({ d: m.received_on || '', r: 0, t: m.created_at || '', kind: 'in', x: m }); });
  data.paybacks.forEach(function (b) { ev.push({ d: b.paid_on || '', r: 1, t: b.created_at || '', kind: 'back', x: b }); });
  data.expenses.forEach(function (e) { ev.push({ d: e.spent_on || '', r: 2, t: e.created_at || '', kind: 'out', x: e }); });
  ev.sort(function (a, b) {
    if (!a.d !== !b.d) return a.d ? -1 : 1;
    return a.d.localeCompare(b.d) || (a.r - b.r) || String(a.t).localeCompare(String(b.t));
  });
  var days = [], cash = 0, cur = null;
  ev.forEach(function (e) {
    if (!cur || cur.k !== e.d) { cur = { k: e.d, start: cash, end: cash, items: [], spent: 0 }; days.push(cur); }
    var a = num(e.x.amount), eff = 0;
    if (e.kind === 'in') eff = a;
    else if (e.kind === 'back') eff = e.x.from_cash ? -a : 0;
    else { cur.spent += a; eff = e.x.source === 'cash' ? -a : 0; }
    cash += eff; cur.end = cash; cur.items.push(e);
  });
  return days;
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
function rowWrap(act, id, inner) {
  var tag = isAdmin ? 'button' : 'div';
  return '<li><' + tag + (isAdmin ? ' type="button"' : '') + ' class="row" data-act="' + act + '" data-id="' + h(id) + '">' + inner + '</' + tag + '></li>';
}
function storyRow(e) {
  var x = e.x;
  if (e.kind === 'in') {
    return rowWrap('edit-in', x.id, '<span class="r-main"><span class="r-title">Received from ' + h(x.from_name) + '</span>' + (x.note ? '<span class="r-meta">' + h(x.note) + '</span>' : '') + '</span><span class="r-amt in">+' + money(x.amount) + '</span>');
  }
  if (e.kind === 'back') {
    return rowWrap('edit-payback', x.id, '<span class="r-main"><span class="r-title">Paid back to ' + h(x.to_name) + '</span><span class="r-meta">' + h(x.note || (x.from_cash ? 'From the cash' : 'Not from the cash')) + '</span></span><span class="r-amt">−' + money(x.amount) + '</span>');
  }
  if (x.source === 'cash') {
    return rowWrap('edit-expense', x.id, '<span class="r-main"><span class="r-title">' + h(x.description) + '</span><span class="r-meta">' + h(x.category || 'Other') + '</span></span><span class="r-amt">−' + money(x.amount) + '</span>');
  }
  var who = x.paid_by ? h(x.paid_by) : 'family';
  return rowWrap('edit-expense', x.id, '<span class="r-main"><span class="r-title">' + h(x.description) + '</span><span class="r-meta">Paid by ' + who + ' from own pocket, not from the cash'
    + (x.pay_back ? (settledNames[key(x.paid_by)] ? '<span class="tag ok">paid back ✓</span>' : '<span class="tag">to pay back</span>') : '') + '</span></span><span class="r-amt own">' + money(x.amount) + '</span>');
}
function dayCard(day) {
  var out = '<article class="daycard card"><header class="dc-head"><h3>' + h(longDay(day.k)) + '</h3>' + (day.spent ? '<span class="dc-spent">Spent ' + money(day.spent) + '</span>' : '') + '</header>'
    + '<div class="dc-line start"><span>Cash at start of day</span><span>' + money(day.start) + '</span></div>'
    + '<ul class="rows">' + day.items.map(storyRow).join('') + '</ul>'
    + '<div class="dc-line end"><span>Cash left at end of day</span><span>' + money(day.end) + '</span></div></article>';
  return out;
}
function categoryList(c) {
  var cats = Object.keys(c.cats).map(function (k) { return [k, c.cats[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  if (!cats.length) return '<p class="empty">Spending by category appears here once expenses are added.</p>';
  var max = cats[0][1] || 1;
  return '<ul class="cats card">' + cats.map(function (x) {
    var share = c.total > 0 ? Math.round(x[1] / c.total * 100) : 0;
    return '<li><div class="cat"><span class="cat-top"><span>' + h(x[0]) + '</span><span class="num">' + money(x[1]) + '<em>' + share + '%</em></span></span><span class="bar"><span style="width:' + Math.max(1, x[1] / max * 100).toFixed(1) + '%"></span></span></div></li>';
  }).join('') + '</ul>';
}
function personCard(p, full) {
  var out = '<div class="owe"><span class="owe-name">' + h(p.name) + '</span>';
  if (p.left > 0.5) out += '<span class="owe-amt">We owe ' + money(p.left) + '</span>';
  else if (p.owed > 0) out += '<span class="owe-amt ok">Paid back ✓</span>';
  else if (p.pending > 0) out += '<span class="owe-amt">To give ' + money(p.pending) + '</span>';
  else out += '<span class="owe-amt ok">' + money(p.gave) + '</span>';
  var bits = [];
  if (p.owed > 0) bits.push('Paid ' + money(p.owed) + ' from own pocket · returned ' + money(p.returned));
  if (full && p.gave > 0) bits.push('Gave ' + money(p.gave) + ' treatment money');
  if (full && p.pending > 0 && p.owed > 0) bits.push('Still to give ' + money(p.pending));
  if (bits.length) out += '<span class="owe-detail">' + bits.join('<br>') + '</span>';
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
  var range = c.first ? fmtDay(c.first) + (c.last && c.last !== c.first ? ' – ' + fmtDay(c.last) : '') : '';
  var html = '<section class="hero" aria-label="Total spent"><span class="hero-label">Total spent on treatment</span><span class="hero-num">' + money(c.total) + '</span>'
    + '<span class="hero-meta">' + (range ? range + ' · ' : '') + plural(data.expenses.length, 'expense', 'expenses') + '</span>'
    + '<div class="hero-row"><div><span>Cash left now</span><b>' + money(c.cash) + '</b></div><div><span>Spent today</span><b>' + money(c.todaySpent) + '</b></div></div></section>';

  html += '<section class="sec" aria-labelledby="h-sum"><div class="sec-head"><h2 id="h-sum">Where the money came from and went</h2></div><div class="card lines">'
    + '<div class="line"><span>Treatment money received</span><span class="in">+' + money(c.cashIn) + '</span></div>'
    + '<div class="line"><span>Spent from this money</span><span>−' + money(c.cashOut) + '</span></div>'
    + (c.paidBackCash ? '<div class="line"><span>Paid back to people from it</span><span>−' + money(c.paidBackCash) + '</span></div>' : '')
    + '<div class="line total"><span>Cash left now</span><span>' + money(c.cash) + '</span></div></div>'
    + (c.ownPocket ? '<p class="note">Another ' + money(c.ownPocket) + ' was paid by people from their own pocket. That is included in the total spent, and shown below.</p>' : '')
    + '</section>';

  var ownPeople = c.people.filter(function (p) { return p.owed > 0; });
  html += '<section class="sec" aria-labelledby="h-owe"><div class="sec-head"><h2 id="h-owe">Paid from own pocket</h2>' + (c.due ? '<span class="label due">Still to pay back ' + money(c.due) + '</span>' : '') + '</div>';
  html += ownPeople.length ? '<div class="card">' + ownPeople.map(function (p) { return personCard(p, false); }).join('') + '</div>' : '<p class="empty">Nobody has paid from their own pocket.</p>';
  html += '</section>';

  html += '<section class="sec" aria-labelledby="h-cats"><div class="sec-head"><h2 id="h-cats">Spent on what</h2></div>' + categoryList(c) + '</section>';

  var days = timeline();
  var lastDay = days.filter(function (d) { return d.k; }).pop();
  if (lastDay) {
    html += '<section class="sec" aria-labelledby="h-last"><div class="sec-head"><h2 id="h-last">Latest day</h2></div>' + dayCard(lastDay)
      + '<button type="button" class="more" data-act="tab" data-tab="days">See the full story, day by day →</button></section>';
  }
  return html;
}

function daysView(c) {
  var days = timeline();
  var html = '<section class="sec" aria-labelledby="h-days"><div class="sec-head"><h2 id="h-days">Day by day</h2><span class="label">' + plural(days.length, 'day', 'days') + '</span></div>'
    + '<p class="note">Every day in order: money received, money spent, and the cash left at the end of the day. That cash carries over to the next day.</p>';
  html += days.length ? '<div class="timeline">' + days.map(dayCard).join('') + '</div>' : '<p class="empty">Nothing recorded yet.</p>';
  if (days.length) html += '<div class="card lines"><div class="line total"><span>Cash left now</span><span>' + money(c.cash) + '</span></div><div class="line"><span>Total spent on treatment</span><span>' + money(c.total) + '</span></div></div>';
  return html + '</section>';
}

function moneyView(c) {
  var html = '<section class="sec" aria-labelledby="h-people"><div class="sec-head"><h2 id="h-people">Everyone who helped</h2></div>';
  var everyone = c.people.filter(function (p) { return p.owed > 0 || p.gave > 0 || p.pending > 0 || p.returned > 0; });
  html += everyone.length ? '<div class="card">' + everyone.map(function (p) { return personCard(p, true); }).join('') + '</div>' : '<p class="empty">Nobody has paid or given money yet.</p>';
  html += '</section>';

  html += '<section class="sec" aria-labelledby="h-in"><div class="sec-head"><h2 id="h-in">Treatment money received</h2><span class="label">' + money(c.cashIn) + '</span></div>';
  if (data.moneyIn.length) {
    html += '<ul class="rows card">' + data.moneyIn.slice().sort(byDateDesc('received_on')).map(function (m) {
      var tags = (m.received ? '' : '<span class="tag">still to receive</span>') + (m.returnable ? '<span class="tag">to return</span>' : '');
      return rowWrap('edit-in', m.id, '<span class="r-main"><span class="r-title">From ' + h(m.from_name) + tags + '</span><span class="r-meta">' + h(dayLabel(m.received_on)) + (m.note ? ' · ' + h(m.note) : '') + '</span></span><span class="r-amt in">+' + money(m.amount) + '</span>');
    }).join('') + '</ul>';
  } else html += '<p class="empty">No money received yet.</p>';
  html += '</section>';

  html += '<section class="sec" aria-labelledby="h-rep"><div class="sec-head"><h2 id="h-rep">Money paid back</h2><span class="label">' + money(c.returned) + '</span></div>';
  if (data.paybacks.length) {
    html += '<ul class="rows card">' + data.paybacks.slice().sort(byDateDesc('paid_on')).map(function (b) {
      return rowWrap('edit-payback', b.id, '<span class="r-main"><span class="r-title">Paid back to ' + h(b.to_name) + '</span><span class="r-meta">' + h(dayLabel(b.paid_on)) + (b.note ? ' · ' + h(b.note) : '') + '</span></span><span class="r-amt">' + money(b.amount) + '</span>');
    }).join('') + '</ul>';
  } else html += '<p class="empty">Nothing paid back yet.</p>';
  return html + '</section>';
}

function footer() {
  return '<footer class="foot"><p>To keep this on your phone, open the link in Chrome or Safari and choose <b>Add to Home Screen</b>.</p>'
    + '<div class="foot-actions">' + (deferredInstall ? '<button type="button" class="link-btn" data-act="install">Install app</button>' : '')
    + '<button type="button" class="link-btn" data-act="reload">Refresh</button>'
    + (isAdmin ? '<button type="button" class="link-btn" data-act="settings">Rename</button><button type="button" class="link-btn" data-act="logout">Sign out</button>'
               : (session ? '<button type="button" class="link-btn" data-act="logout">Sign out</button>' : '<button type="button" class="link-btn" data-act="login">Admin sign in</button>'))
    + '</div></footer>';
}

var settledNames = {};
function render() {
  if (!loaded) return;
  var c = compute();
  settledNames = {}; c.people.forEach(function (p) { if (p.owed > 0 && p.left <= 0.5) settledNames[key(p.name)] = 1; });
  document.title = data.title;
  app.innerHTML = header() + (tab === 'days' ? daysView(c) : tab === 'money' ? moneyView(c) : overview(c)) + footer();
  renderChrome();
}
function renderEntries() {}

/* ---------- tab bar + add button ---------- */
var ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  days: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14.5" r="1.2"/></svg>'
};
var nav = document.createElement('nav'); nav.className = 'tabbar'; nav.setAttribute('aria-label', 'Sections'); document.body.appendChild(nav);
var fab = document.createElement('button'); fab.type = 'button'; fab.className = 'fab'; fab.setAttribute('data-act', 'add-menu'); fab.textContent = '+ Add'; fab.hidden = true; document.body.appendChild(fab);
function renderChrome() {
  nav.innerHTML = '<div class="tabbar-in">' + [['overview', 'Summary'], ['days', 'Day by day'], ['money', 'People']].map(function (t) {
    return '<button type="button" class="tab" data-act="tab" data-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + ICONS[t[0]] + '<span>' + t[1] + '</span></button>';
  }).join('') + '</div>';
  fab.hidden = !isAdmin;
}
function setTab(t) {
  if (TABS.indexOf(t) < 0) t = 'overview';
  if (location.hash.slice(1) !== t) { location.hash = t; return; }
  tab = t; render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', function () {
  var t = location.hash.slice(1); tab = TABS.indexOf(t) >= 0 ? t : 'overview'; render(); window.scrollTo(0, 0);
});
function openAddMenu() {
  openSheet('<div class="form"><h2 id="sheet-title">What do you want to add?</h2><div class="choices">'
    + '<button type="button" class="choice" data-act="add-expense"><b>Expense</b><span>Money spent on treatment</span></button>'
    + '<button type="button" class="choice" data-act="add-in"><b>Money received</b><span>Treatment money someone gave</span></button>'
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
  if (act === 'filter-cat') return;
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
