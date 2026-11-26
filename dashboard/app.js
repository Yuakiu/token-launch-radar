// Token Launch Radar dashboard. Everything it shows is in window.RADAR (data.js, written beside
// this folder by main.ts from the same board.json): no fetch, no network, no framework.
// Four views: the leaderboard with filters and a per-protocol detail, the farm plans, the model
// itself with the category multiples it priced from, and the set-aside lists (protocols whose
// token already trades, and wrapped/staked/bridged products of traded tokens).
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  var params = new URLSearchParams(location.search);
  var state = {
    view: params.get('view') || 'board',
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    band: params.get('band') || 'all',
    watchOnly: params.get('watch') === '1',
    sort: 'implied_value_usd',
    dir: -1,
    slug: params.get('slug') || null,
  };
  if (state.view === 'board' && state.slug) state.view = 'board';

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.round(days) + ' days';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function bySlug(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }

  /* Header stats and footer */
  var totalImplied = D.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  var stats = [
    [String(D.board_size), 'protocols ranked'],
    [String(D.watchlist_size) + ' / ' + String(D.watchlist_size), 'watchlist covered'],
    [String(D.early_size), 'early, below the $50M floor'],
    [fmtUsd(totalImplied), 'combined implied value'],
    [D.as_of, 'snapshot date'],
  ];
  var ts = document.getElementById('topstats');
  stats.forEach(function (s) { ts.appendChild(el('div', { class: 'stat' }, el('b', { text: s[0] }), el('span', { text: s[1] }))); });
  document.getElementById('foot').textContent =
    'Model ' + D.model_version + '. Every figure is derived from the sealed snapshot alone (' + D.source + '). ' +
    'An implied value is this entry\'s estimate of what a launch could be worth if the protocol\'s record stayed as it is — not a prediction that a token will be issued.';

  /* Tabs */
  var tabs = document.getElementById('tabs');
  tabs.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.getAttribute('data-view');
    render();
  });
  function markTabs() {
    tabs.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === state.view);
    });
  }

  /* ---------- Leaderboard ---------- */
  var BANDS = [
    ['all', 'Any implied value'],
    ['b1', '$1B and up'],
    ['b2', '$250M – $1B'],
    ['b3', '$50M – $250M'],
    ['b4', '$10M – $50M'],
    ['b5', 'Under $10M'],
  ];
  function inBand(v, band) {
    if (band === 'b1') return v >= 1e9;
    if (band === 'b2') return v >= 2.5e8 && v < 1e9;
    if (band === 'b3') return v >= 5e7 && v < 2.5e8;
    if (band === 'b4') return v >= 1e7 && v < 5e7;
    if (band === 'b5') return v < 1e7;
    return true;
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || '(uncategorised)') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (!inBand(r.implied_value_usd, state.band)) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sort;
      var av = a[k], bv = b[k];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (av === bv) return a.rank - b.rank;
      return (av < bv ? -1 : 1) * state.dir;
    });
  }
  function selectOptions(list, current, allLabel) {
    var sel = el('select', {});
    sel.appendChild(el('option', { value: 'all', text: allLabel }));
    list.forEach(function (v) {
      var o = el('option', { value: v, text: v });
      if (v === current) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    });
    return sel;
  }
  function boardView() {
    var view = el('section', { class: 'view' });
    var cats = [], chains = [], seenC = {}, seenH = {};
    D.rows.forEach(function (r) {
      var c = r.category || '(uncategorised)';
      if (!seenC[c]) { seenC[c] = 1; cats.push(c); }
      r.chains.forEach(function (h) { if (!seenH[h]) { seenH[h] = 1; chains.push(h); } });
    });
    cats.sort(); chains.sort();
    var controls = el('div', { class: 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search' });
    search.addEventListener('input', function () { state.q = search.value; refreshTable(); });
    var catSel = selectOptions(cats, state.category, 'All categories');
    catSel.addEventListener('change', function () { state.category = catSel.value; refreshTable(); });
    var chainSel = selectOptions(chains, state.chain, 'All chains');
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; refreshTable(); });
    var bandSel = el('select', {});
    BANDS.forEach(function (b) {
      var o = el('option', { value: b[0], text: b[1] });
      if (state.band === b[0]) o.setAttribute('selected', 'selected');
      bandSel.appendChild(o);
    });
    bandSel.addEventListener('change', function () { state.band = bandSel.value; refreshTable(); });
    var watchBox = el('input', { type: 'checkbox' });
    if (state.watchOnly) watchBox.setAttribute('checked', 'checked');
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; refreshTable(); });
    var count = el('span', { class: 'count' });
    controls.append(search, el('label', {}, 'Category', catSel), el('label', {}, 'Chain', chainSel), el('label', {}, 'Value band', bandSel),
      el('label', { class: 'check' }, watchBox, 'Watchlist only'), count);
    view.appendChild(controls);
    var tableWrap = el('div', {});
    view.appendChild(tableWrap);
    var detailWrap = el('div', {});
    view.appendChild(detailWrap);

    var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;
    function refreshTable() {
      var rows = filtered();
      count.textContent = rows.length + ' of ' + D.board_size + ' shown';
      tableWrap.textContent = '';
      if (!rows.length) { tableWrap.appendChild(el('p', { class: 'empty', text: 'No protocol matches these filters.' })); return; }
      var cols = [
        ['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', ''],
        ['chains', 'Chains', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num'],
        ['age_days', 'Tracked', 'num'], ['implied_value_usd', 'Implied value', 'num'], ['bar', 'Share of #1', ''],
      ];
      var thead = el('thead', {}, el('tr', {}, cols.map(function (c) {
        var th = el('th', { class: c[2] + (c[0] !== 'bar' && c[0] !== 'chains' && c[0] !== 'category' && c[0] !== 'name' ? ' sortable' : ''), text: c[1] + (state.sort === c[0] ? (state.dir === -1 ? ' ↓' : ' ↑') : '') });
        if (th.className.indexOf('sortable') !== -1) th.addEventListener('click', function () {
          if (state.sort === c[0]) state.dir = -state.dir; else { state.sort = c[0]; state.dir = -1; }
          refreshTable();
        });
        return th;
      })));
      var tbody = el('tbody', {});
      rows.forEach(function (r) {
        var tr = el('tr', { class: 'row' + (state.slug === r.slug ? ' sel' : '') },
          el('td', { class: 'rank num', text: String(r.rank) }),
          el('td', { class: 'name' }, r.name, el('span', { class: 'slug', text: r.slug })),
          el('td', {}, el('span', { class: 'pill', text: r.category || 'Uncategorised' }), r.watchlist ? el('div', {}, el('span', { class: 'watch', text: '★ WATCHLIST' })) : null),
          el('td', { class: 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', { class: 'num' }, el('span', { class: 'value', text: fmtUsd(r.implied_value_usd) }), el('span', { class: 'range', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) })),
          el('td', {}, el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(1.5, (r.implied_value_usd / maxImplied) * 100).toFixed(1) + '%' })))
        );
        tr.addEventListener('click', function () { state.slug = r.slug; refreshTable(); renderDetail(); });
        tbody.appendChild(tr);
      });
      tableWrap.appendChild(el('table', {}, thead, tbody));
    }
    function renderDetail() {
      detailWrap.textContent = '';
      var r = state.slug ? bySlug(state.slug) : null;
      if (!r) {
        detailWrap.appendChild(el('p', { class: 'empty', text: 'Select any row for its detail: the model\'s workings and its farm plan.' }));
        return;
      }
      detailWrap.appendChild(detailNode(r));
    }
    refreshTable();
    renderDetail();
    return view;
  }

  function detailNode(r) {
    var m = r.model;
    var box = el('article', { class: 'detail', id: 'detail' });
    var close = el('button', { class: 'close', text: 'Close ×' });
    close.addEventListener('click', function () { box.remove(); });
    box.appendChild(close);
    box.appendChild(el('h2', { text: r.name + ' — rank #' + r.rank }));
    box.appendChild(el('p', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + r.slug + (r.watchlist ? ' · on the house watchlist' : ' · early radar, below the $50M watchlist floor') + ' · records no token in the snapshot' }));
    var cells = [
      [fmtUsd(r.implied_value_usd), 'implied value'],
      [fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd), 'value range (category quartiles)'],
      [fmtUsd(r.tvl_usd), 'TVL'],
      [fmtPct(r.change_7d), 'TVL change, 7d'],
      [fmtAge(r.age_days), 'tracked by DefiLlama'],
      [r.chains.join(', '), 'chains (' + r.chains.length + ')'],
    ];
    box.appendChild(el('div', { class: 'grid' }, cells.map(function (c) { return el('div', { class: 'cell' }, el('span', { text: c[1] }), el('b', { text: c[0] })); })));
    var f = el('p', { class: 'formula' });
    f.innerHTML = 'implied <span class="op">=</span> TVL <span class="v">' + fmtUsd(r.tvl_usd) + '</span> <span class="op">×</span> category multiple <span class="v">' + m.category_multiple.toFixed(3) + '</span> <span class="op">×</span> growth <span class="v">' + m.growth_multiplier.toFixed(3) + '</span> <span class="op">×</span> maturity <span class="v">' + m.maturity_multiplier.toFixed(3) + '</span> <span class="op">×</span> breadth <span class="v">' + m.breadth_multiplier.toFixed(3) + '</span> <span class="op">=</span> <span class="v">' + fmtUsd(r.implied_value_usd) + '</span>';
    box.appendChild(f);
    box.appendChild(el('h3', { class: 'steps-title', text: 'Farm plan — ' + r.farm_plan.length + ' steps' }));
    box.appendChild(planList(r));
    return box;
  }
  function planList(r) {
    var ol = el('ol', { class: 'plan' });
    r.farm_plan.forEach(function (s) {
      var li = el('li', {}, s.text + ' ');
      li.appendChild(el('span', { class: 'meta' }, el('b', { text: 'Cost: ' }), s.cost + ' · ', el('b', { text: 'Time: ' }), s.time));
      ol.appendChild(li);
    });
    return ol;
  }

  /* ---------- Farm plans ---------- */
  function farmView() {
    var view = el('section', { class: 'view' });
    var head = el('div', { class: 'farm-head' });
    var sel = el('select', { 'aria-label': 'Protocol' });
    D.rows.forEach(function (r) {
      var o = el('option', { value: r.slug, text: '#' + r.rank + '  ' + r.name + ' — ' + fmtUsd(r.implied_value_usd) });
      if (state.slug === r.slug) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    });
    if (!state.slug && D.rows.length) state.slug = D.rows[0].slug;
    var body = el('div', {});
    sel.addEventListener('change', function () { state.slug = sel.value; draw(); });
    head.append(el('label', {}, 'Protocol', sel));
    view.append(head, body);
    function draw() {
      body.textContent = '';
      var r = bySlug(state.slug);
      if (!r) return;
      body.appendChild(el('p', { class: 'aside-note', text: 'The plan for ' + r.name + ' (' + (r.category || 'Uncategorised') + ', first chain ' + (r.chains[0] || 'n/a') + '). Steps are written for this protocol\'s category, chain fees and size; every step states what it costs and how long it takes.' }));
      var totals = el('div', { class: 'totals' },
        el('div', { class: 'stat' }, el('b', { text: String(r.farm_plan.length) }), el('span', { text: 'steps' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(r.implied_value_usd) }), el('span', { text: 'implied value' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(r.tvl_usd) }), el('span', { text: 'protocol TVL' })),
        el('div', { class: 'stat' }, el('b', { text: '#' + r.rank }), el('span', { text: 'board rank' })));
      body.appendChild(totals);
      body.appendChild(planList(r));
      var open = el('button', { class: 'tab', text: 'Open ' + r.name + ' on the leaderboard' });
      open.addEventListener('click', function () { state.view = 'board'; render(); var d = document.getElementById('detail'); if (d) d.scrollIntoView(); });
      body.appendChild(open);
    }
    draw();
    return view;
  }

  /* ---------- The model ---------- */
  function modelView() {
    var view = el('section', { class: 'view' });
    view.appendChild(el('h2', { text: 'How every number on the board is priced — model ' + D.model_version }));
    var notes = el('div', { class: 'notes' });
    D.model_notes.forEach(function (n) { notes.appendChild(el('p', { text: n })); });
    view.appendChild(notes);
    view.appendChild(el('h3', { class: 'steps-title', text: 'Category multiples priced from the snapshot\'s live tokens' }));
    var mm = D.market_multiple;
    var rows = [[mm.category, mm.live_peers, mm.low_multiple, mm.multiple, mm.high_multiple]].concat(
      D.categories.slice(0, 30).map(function (c) { return [c.category, c.live_peers, c.low_multiple, c.multiple, c.high_multiple]; }));
    var tbody = el('tbody', {}, rows.map(function (c) {
      return el('tr', {},
        el('td', { text: c[0] }), el('td', { class: 'num', text: String(c[1]) }),
        el('td', { class: 'num', text: c[2].toFixed(3) }), el('td', { class: 'num value', text: c[3].toFixed(3) }), el('td', { class: 'num', text: c[4].toFixed(3) }));
    }));
    view.appendChild(el('table', { class: 'mini' },
      el('thead', {}, el('tr', {}, ['Category', 'Live peers', 'Low (p25)', 'Multiple (median)', 'High (p75)'].map(function (h, i) { return el('th', { class: i ? 'num' : '', text: h }); }))), tbody));
    view.appendChild(el('p', { class: 'aside-note', text: 'A category with few live peers leans on the all-market row: its multiples are shrunk toward the market\'s with a prior weight of 5 observations.' }));
    return view;
  }

  /* ---------- Set aside ---------- */
  function asideTable(list, withMcap) {
    var tbody = el('tbody', {}, list.map(function (r) {
      var cells = [
        el('td', { class: 'name' }, r.name, el('span', { class: 'slug', text: r.slug })),
        el('td', {}, el('span', { class: 'pill', text: r.category || 'Uncategorised' })),
        el('td', { class: 'chains', text: r.chains.slice(0, 3).join(', ') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      ];
      if (withMcap) cells.push(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      cells.push(el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
      cells.push(el('td', { class: 'reason', text: r.reason }));
      return el('tr', {}, cells);
    }));
    var heads = ['Protocol', 'Category', 'Chains', 'TVL'];
    if (withMcap) heads.push('Market cap');
    heads.push('7d', 'Why it is set aside');
    return el('table', {}, el('thead', {}, el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))), tbody);
  }
  function asideView() {
    var view = el('section', { class: 'view' });
    view.appendChild(el('h2', { text: 'Already trading — the market\'s own values' }));
    view.appendChild(el('p', { class: 'aside-note', text: 'These protocols\' tokens already trade, so there is no launch to price: the board shows the top ' + D.live.length + ' by market cap at the market\'s own figure and never mixes them into the ranking.' }));
    view.appendChild(asideTable(D.live, true));
    view.appendChild(el('h2', { class: 'steps-title', text: 'Products of traded tokens — not launches to come' }));
    view.appendChild(el('p', { class: 'aside-note', text: 'These record no token of their own, but each is a wrapped, staked or bridged product of a token that already trades (or a versioned pool or exchange product), by the same tests the house watchlist uses. A wrapped token is not a token that does not exist yet, so the radar sets the top ' + D.products.length + ' by TVL aside instead of ranking them.' }));
    view.appendChild(asideTable(D.products, false));
    return view;
  }

  /* ---------- Render ---------- */
  function render() {
    markTabs();
    app.textContent = '';
    var view = state.view === 'farm' ? farmView() : state.view === 'model' ? modelView() : state.view === 'aside' ? asideView() : boardView();
    app.appendChild(view);
    app.setAttribute('aria-busy', 'false');
  }
  render();
})();
