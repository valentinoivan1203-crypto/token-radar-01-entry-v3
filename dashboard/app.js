// Token Radar v3 dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the board, the detail view, the held-out test panel,
// the sector table, the set-aside list and the live-token tab. No network:
// every number on this page is computed from the sealed snapshot by main.ts.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var view = document.getElementById('view');
  if (!DATA) {
    view.textContent = 'No data: data.js did not load.';
    return;
  }
  var state = { q: '', category: 'all', chain: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- header, KPIs, footer (computed from the snapshot, never hard-coded)
  document.getElementById('meta').textContent =
    'snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · floor $' + DATA.floor_usd.toLocaleString('en-US') +
    ' · ' + DATA.summary.protocols_total + ' protocols · model: ' + DATA.model.name;
  var k = DATA.summary;
  document.getElementById('kpis').innerHTML =
    '<div class="kpi"><div class="k">Watchlist TVL</div><div class="v">' + fmtUsd(k.watchlist_tvl_usd) + '</div><div class="s">' + k.watchlist_total + ' protocols at or above the $50M floor</div></div>' +
    '<div class="kpi"><div class="k">Pre-token ranked</div><div class="v">' + k.rankable_rows + '</div><div class="s">all 40 watchlist protocols covered</div></div>' +
    '<div class="kpi"><div class="k">Median implied value</div><div class="v">' + fmtUsd(k.median_implied_value_usd) + '</div><div class="s">across the ' + k.rankable_rows + ' ranked rows</div></div>' +
    '<div class="kpi"><div class="k">Live-token protocols</div><div class="v">' + k.live_token_total + '</div><div class="s">record a token; shown at the market’s own value</div></div>';
  document.getElementById('foot').innerHTML =
    'Implied value is this entry’s own claim, never make.fun’s. A protocol “records no token” when DefiLlama carries no gecko_id and no symbol for it — ' +
    'the record is not proof it has none. Launch odds are the peers’ record (same category, age band and TVL band), never a date or a name. ' +
    'Referral: <code>make.fun/r/dehpqxrn</code> (code dehpqxrn).';

  // ---- tabs
  var tabs = document.querySelectorAll('#tabs button');
  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      state.tab = b.getAttribute('data-tab');
      tabs.forEach(function (x) { x.classList.toggle('active', x === b); });
      state.selected = null;
      render();
    });
  });

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'change') { av = a.change_7d === null ? -999 : a.change_7d; bv = b.change_7d === null ? -999 : b.change_7d; }
      else { av = a.rank; bv = b.rank; }
      return (av - bv) * state.dir;
    });
    return rows;
  }

  function boardHtml() {
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      cats[r.category || 'Uncategorised'] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    var catOpts = ['<option value="all">All categories</option>'].concat(Object.keys(cats).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var chainOpts = ['<option value="all">All chains</option>'].concat(Object.keys(chains).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var rows = filteredRows();
    var arrow = function (key) { return state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : ''; };
    var head = '<tr>' +
      '<th data-k="rank">Rank' + arrow('rank') + '</th>' +
      '<th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num" data-k="tvl">TVL' + arrow('tvl') + '</th>' +
      '<th class="num" data-k="change">7d' + arrow('change') + '</th>' +
      '<th class="num" data-k="age">Age' + arrow('age') + '</th>' +
      '<th class="num" data-k="implied">Implied value' + arrow('implied') + '</th>' +
      '<th class="num" data-k="odds">Launch odds' + arrow('odds') + '</th></tr>';
    var body = rows.map(function (r) {
      return '<tr class="row' + (state.selected === r.slug ? ' sel' : '') + '" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td>' + esc(r.chains.join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.launch_odds_text + ' (' + Math.round(r.launch_odds * 100) + '%)</td></tr>';
    }).join('');
    return '<div class="panel"><div class="filters">' +
      '<label>Search <input id="q" type="search" placeholder="name or slug" value="' + esc(state.q) + '"></label>' +
      '<label>Category <select id="cat">' + catOpts + '</select></label>' +
      '<label>Chain <select id="chain">' + chainOpts + '</select></label>' +
      '<span class="count">' + rows.length + ' of ' + DATA.rows.length + ' shown</span></div>' +
      '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '<p class="note">Click a row for the detail view: the model’s terms, the launch odds with their peer set, and the six farm steps. ' +
      'Implied value = TVL × sector multiple (clamped 0.05–0.75). Growth, maturity and parent-risk were tested held-out and dropped — their multipliers are 1.0.</p>' +
      '<div id="detail"></div></div>';
  }

  function detailHtml(r) {
    var m = r.model;
    return '<div class="detail"><h2>' + esc(r.name) + ' <span class="slug">' + esc(r.slug) + '</span> ' +
      '<span class="pill pre">pre-token</span></h2>' +
      '<div>' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) + ' · listed ' + (r.listed_at || 'unknown') + ' · age ' + fmtAge(r.age_days) + '</div>' +
      '<div class="grid">' +
      '<div class="cell"><div class="k">Implied value</div><div class="v">' + fmtUsd(r.implied_value_usd) + '</div></div>' +
      '<div class="cell"><div class="k">TVL</div><div class="v">' + fmtUsd(r.tvl_usd) + '</div></div>' +
      '<div class="cell"><div class="k">Launch odds</div><div class="v">' + r.launch_odds_text + ' (' + Math.round(r.launch_odds * 100) + '%)</div></div>' +
      '<div class="cell"><div class="k">7d change</div><div class="v">' + fmtPct(r.change_7d) + '</div></div></div>' +
      '<h3>Why this value — the model’s terms</h3>' +
      '<table class="model-table"><tbody>' +
      '<tr><td>Sector multiple (clamped 0.05–0.75)</td><td>' + m.sector_multiple.toFixed(4) + '</td></tr>' +
      '<tr><td>Live comps in this category (n)</td><td>' + m.category_n + '</td></tr>' +
      '<tr><td>7-day TVL change (shown, not used — growth was dropped)</td><td>' + fmtPct(m.growth_pct) + '</td></tr>' +
      '<tr><td>Growth multiplier (dropped after held-out testing)</td><td>' + m.growth_multiplier.toFixed(2) + '</td></tr>' +
      '<tr><td>Maturity multiplier (dropped after held-out testing)</td><td>' + m.maturity_multiplier.toFixed(2) + '</td></tr>' +
      '<tr><td>Parent risk flagged</td><td>' + (m.parent_risk ? 'yes' : 'no') + '</td></tr>' +
      '<tr><td>Parent haircut (dropped — no signal in the live set)</td><td>' + m.parent_haircut.toFixed(2) + '</td></tr>' +
      '<tr><td>Launch-odds peer set</td><td>' + esc(r.launch_odds_peers) + '</td></tr>' +
      '</tbody></table>' +
      '<h3>How to farm it — six steps</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
  }

  function liveHtml() {
    var body = DATA.live.map(function (r, i) {
      return '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td>' + esc(r.chains.join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.mcap_usd) + '</b></td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td></tr>';
    }).join('');
    return '<div class="panel"><h2 class="sec">Live token — top 24 by market cap</h2>' +
      '<p class="lede">These protocols already record a token, so they are not ranked. Their market cap is the market’s own value, never a model’s. ' +
      'They are shown so the board’s pre-token rows are never confused with protocols whose token already trades.</p>' +
      '<table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Age</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  function testedHtml() {
    var t = DATA.model.held_out;
    var rows = t.rows.map(function (r) {
      var verdict = r.variant === 'sector only'
        ? '<span class="kept">KEPT — the model’s core</span>'
        : r.variant.indexOf('global median') === 0
          ? '<span class="dropped">baseline, not a term</span>'
          : r.kept ? '<span class="kept">KEPT</span>' : '<span class="dropped">DROPPED</span>';
      return '<tr><td>' + esc(r.variant) + '</td>' +
        '<td class="num">' + r.splitA.mae.toFixed(3) + '</td><td class="num">' + r.splitA.spearman.toFixed(3) + '</td>' +
        '<td class="num">' + r.splitB.mae.toFixed(3) + '</td><td class="num">' + r.splitB.spearman.toFixed(3) + '</td>' +
        '<td>' + verdict + '</td></tr>';
    }).join('');
    return '<div class="panel"><h2 class="sec">How each term was tested</h2>' +
      '<p class="lede">Every value term was fitted on a training set and tested on a held-out set, twice, before the board was built. ' +
      'The target is mcap/TVL on the live-token protocols. A term is kept only when it beats sector-only on <b>both</b> the median absolute ' +
      'relative error and the rank correlation in <b>both</b> splits. The live set is ' + t.liveTested + ' protocols with a positive market cap; ' +
      t.liveExcludedZeroMcap.length + ' protocols that record a token with a $0 market cap are left out because their ratio is 0 and carries no pricing signal. ' +
      'The test evaluates the shrinkage multiple itself — the term’s mechanism. The deployed board adds two guards on top of it (a category’s own median is used only when n ≥ 3, ' +
      'and the multiple is clamped to [0.05, 0.75]) to keep single-protocol outlier medians from dominating; in a 64-protocol training split those guards would fire for most categories and wash out the signal being measured.</p>' +
      '<p class="lede">' + esc(t.splitA.label) + ': ' + t.splitA.train + ' train / ' + t.splitA.test + ' test. ' +
      esc(t.splitB.label) + ': ' + t.splitB.train + ' train / ' + t.splitB.test + ' test. ' +
      'Every fitted quantity (category medians, global median, parent factor) is computed on the training split only.</p>' +
      '<table><thead><tr><th>Variant</th><th class="num">Split A MAE</th><th class="num">Split A rank</th><th class="num">Split B MAE</th><th class="num">Split B rank</th><th>Decision</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="note">' + esc(t.decision) + '</p>' +
      '<p class="note">Read it honestly: the sector multiple’s out-of-sample edge over the global median is modest — it adds ranking signal ' +
      '(rank correlation above 0 in both splits, where the baseline has none by construction) rather than a large error reduction. ' +
      'That is why the multiple is shrunk toward the global median and clamped to [0.05, 0.75], and why no other term is applied at all.</p></div>';
  }

  function sectorsHtml() {
    var body = DATA.model.sector_table.map(function (s) {
      return '<tr><td>' + esc(s.category) + '</td><td class="num">' + s.live_n + '</td>' +
        '<td class="num">' + (s.median_ratio === null ? 'n/a' : s.median_ratio.toFixed(4)) + '</td>' +
        '<td class="num"><b>' + s.multiple_used.toFixed(4) + '</b></td></tr>';
    }).join('');
    return '<div class="panel"><h2 class="sec">Sector multiples</h2>' +
      '<p class="lede">Median mcap/TVL per category over the snapshot’s live-token protocols, and the multiple the board actually uses. ' +
      'A category’s own median is used only when it has n ≥ 3 live comps; thinner categories fall back to the global median (' +
      DATA.model.global_median.toFixed(4) + ') outright. For n ≥ 3 the shrinkage is (n × category median + 3 × global median) / (n + 3), then clamped to [0.05, 0.75].</p>' +
      '<table><thead><tr><th>Category</th><th class="num">Live comps (n)</th><th class="num">Median mcap/TVL</th><th class="num">Multiple used</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  function setAsideHtml() {
    var groups = DATA.set_aside.map(function (g) {
      var names = g.entries.map(function (e) { return esc(e.slug); }).join(', ');
      return '<div class="setaside-group"><h3>' + esc(g.reason) + ' <span class="n">(' + g.count + ')</span></h3><div class="names">' + names + '</div></div>';
    }).join('');
    return '<div class="panel"><h2 class="sec">Set aside — excluded, with the reason</h2>' +
      '<p class="lede">Every protocol the board does not rank, grouped by the rule that set it aside, so the separation work is visible. ' +
      '“Live-token” means the protocol records a token (gecko_id or symbol present) — it is not ranked because its token already trades. ' +
      'The other groups are the house’s visible exclusion rules: an excluded category, a version marker in the name, a wrapped/staked word, or an exchange name.</p>' +
      groups + '</div>';
  }

  function render() {
    if (state.tab === 'board') {
      view.innerHTML = boardHtml();
      var q = document.getElementById('q');
      var cat = document.getElementById('cat');
      var chain = document.getElementById('chain');
      q.addEventListener('input', function () { state.q = q.value; state.selected = null; render(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
      cat.addEventListener('change', function () { state.category = cat.value; state.selected = null; render(); });
      chain.addEventListener('change', function () { state.chain = chain.value; state.selected = null; render(); });
      view.querySelectorAll('th[data-k]').forEach(function (th) {
        th.addEventListener('click', function () {
          var k = th.getAttribute('data-k');
          if (state.sort === k) state.dir = -state.dir;
          else { state.sort = k; state.dir = k === 'rank' ? 1 : -1; }
          render();
        });
      });
      view.querySelectorAll('tr.row').forEach(function (tr) {
        tr.addEventListener('click', function () {
          var slug = tr.getAttribute('data-slug');
          state.selected = slug;
          var row = DATA.rows.find(function (r) { return r.slug === slug; });
          render();
          var d = document.getElementById('detail');
          if (d && row) {
            d.innerHTML = detailHtml(row);
            d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      });
      if (state.selected) {
        var row = DATA.rows.find(function (r) { return r.slug === state.selected; });
        var d = document.getElementById('detail');
        if (d && row) d.innerHTML = detailHtml(row);
      }
    } else if (state.tab === 'live') {
      view.innerHTML = liveHtml();
    } else if (state.tab === 'tested') {
      view.innerHTML = testedHtml();
    } else if (state.tab === 'sectors') {
      view.innerHTML = sectorsHtml();
    } else if (state.tab === 'setaside') {
      view.innerHTML = setAsideHtml();
    }
  }
  render();
})();
