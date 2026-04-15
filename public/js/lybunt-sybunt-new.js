/**
 * LYBUNT / SYBUNT - NEW dashboard client
 *
 * Powers the rebuilt dashboard at /crm/lybunt-sybunt-new. Loads filtered
 * cohort data, renders KPIs + bands + trend + donor work-queue, and keeps
 * filter state in the URL so views are shareable.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    fy: null,
    category: null,       // LYBUNT | SYBUNT | null
    segment: null,
    yearsSince: null,
    gaveInFyStart: null,
    gaveInFyEnd: null,
    notInFyStart: null,
    notInFyEnd: null,
    minGift: null,
    maxGift: null,
    fundId: null,
    campaignId: null,
    appealId: null,
    constituentType: null,
    sortBy: 'priority',
    includeSuppressed: false,
    page: 1,
    limit: 50,
  };

  let cached = null;
  let trendChart = null;
  let bandsChart = null;
  let outreachStatus = {}; // { [constituentId]: { action_type, action_date, ... } }

  // ---------------------------------------------------------------------------
  // Formatters
  // ---------------------------------------------------------------------------
  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function fmtD(n) { return '$' + fmt(n); }
  function fmtPct(n) { return (Number(n || 0) * 100).toFixed(0) + '%'; }
  function fmtPp(n) {
    const v = Number(n || 0);
    const sign = v >= 0 ? '+' : '';
    return sign + v.toFixed(1) + ' pp';
  }
  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // URL state sync (Wave 4.1)
  // ---------------------------------------------------------------------------
  function stateToQuery() {
    const qs = new URLSearchParams();
    Object.keys(state).forEach(k => {
      const v = state[k];
      if (v == null || v === '' || v === false) return;
      if (k === 'page' && v === 1) return;
      if (k === 'limit' && v === 50) return;
      if (k === 'sortBy' && v === 'priority') return;
      qs.set(k, String(v));
    });
    return qs.toString();
  }

  function queryToState() {
    const qs = new URLSearchParams(window.location.search);
    qs.forEach((v, k) => {
      if (!(k in state)) return;
      if (k === 'page' || k === 'limit') state[k] = parseInt(v, 10) || state[k];
      else if (k === 'fy' && v) state[k] = v;
      else if (k === 'includeSuppressed') state[k] = v === '1' || v === 'true';
      else state[k] = v;
    });
  }

  function pushUrl() {
    const qs = stateToQuery();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '');
    window.history.replaceState({}, '', newUrl);
  }

  // ---------------------------------------------------------------------------
  // Data fetch
  // ---------------------------------------------------------------------------
  function buildFetchUrl(overrides) {
    const merged = Object.assign({}, state, overrides || {});
    const qs = new URLSearchParams();
    Object.keys(merged).forEach(k => {
      const v = merged[k];
      if (v == null || v === '' || v === false) return;
      qs.set(k, String(v));
    });
    return '/crm/lybunt-sybunt-new/data?' + qs.toString();
  }

  function showFilterLoading() {
    const el = document.getElementById('ls2-filter-loading');
    const fill = document.getElementById('ls2-filter-loading-fill');
    if (!el) return;
    el.style.display = 'block';
    fill.style.width = '0%';
    let pct = 0;
    fill._timer = setInterval(() => {
      pct += (100 - pct) * 0.08;
      fill.style.width = Math.min(pct, 92) + '%';
    }, 150);
  }

  function hideFilterLoading() {
    const el = document.getElementById('ls2-filter-loading');
    const fill = document.getElementById('ls2-filter-loading-fill');
    if (!el) return;
    if (fill._timer) clearInterval(fill._timer);
    fill.style.width = '100%';
    setTimeout(() => { el.style.display = 'none'; fill.style.width = '0%'; }, 250);
  }

  function loadData() {
    const isFirst = document.getElementById('ls2-loading').style.display !== 'none';
    if (!isFirst) showFilterLoading();
    pushUrl();
    // STAGE 1: core (KPIs + bands + table) — must succeed fast
    return fetch(buildFetchUrl())
      .then(r => r.json())
      .then(data => {
        hideFilterLoading();
        if (data.error) throw new Error(data.error);
        cached = Object.assign({}, data, {
          // placeholders for stage-2 data — render() fills in skeletons
          pacing: cached ? cached.pacing : null,
          reactivated: cached ? cached.reactivated : null,
          trend: cached ? cached.trend : [],
          cohorts: cached ? cached.cohorts : [],
          filterOptions: cached ? cached.filterOptions : { funds: [], campaigns: [], appeals: [], constituentTypes: [] },
        });
        render(cached);
        // Stages 2-4 are SEQUENCED, not parallel, to avoid saturating the
        // small Postgres connection pool (max 20). A previous parallel
        // fan-out caused the legacy CRM dashboard to timeout because it
        // couldn't get a connection. Each subsequent fetch waits ~250ms
        // after the prior one completes so the browser stays responsive
        // and other tabs still get DB capacity.
        loadSecondary()
          .then(() => new Promise(r => setTimeout(r, 250)))
          .then(() => loadTrend())
          .then(() => new Promise(r => setTimeout(r, 250)))
          .then(() => loadCohorts())
          .catch(err => console.warn('[v2.staged]', err.message));
      })
      .catch(err => {
        hideFilterLoading();
        showModal('Error', err.message || 'Could not load data', 'bi-exclamation-triangle');
        const loader = document.getElementById('ls2-loading');
        if (loader.style.display !== 'none') {
          loader.innerHTML = '<div class="ls2-loading-inner"><div style="color:#dc2626;font-weight:600;">' +
            esc(err.message || 'Error loading dashboard') + '</div></div>';
        }
      });
  }

  function loadSecondary() {
    const fy = state.fy ? '?fy=' + state.fy : '';
    return fetch('/crm/lybunt-sybunt-new/secondary' + fy)
      .then(r => r.json())
      .then(data => {
        if (!cached) return;
        cached.pacing = data.pacing;
        cached.reactivated = data.reactivated;
        cached.filterOptions = data.filterOptions || cached.filterOptions;
        // Re-render only the affected sections to avoid a full repaint
        renderPacing(cached.pacing);
        rerenderKpis(cached);
        rerenderAdvancedFilters(cached.filterOptions);
      })
      .catch(err => console.warn('[v2.secondary]', err.message));
  }

  function loadTrend() {
    const fy = state.fy ? '?fy=' + state.fy : '';
    setTrendLoading(true);
    return fetch('/crm/lybunt-sybunt-new/trend' + fy)
      .then(r => r.json())
      .then(data => {
        setTrendLoading(false);
        if (!cached) return;
        cached.trend = data.trend || [];
        drawTrendChart(cached.trend);
      })
      .catch(err => {
        setTrendLoading(false);
        console.warn('[v2.trend]', err.message);
      });
  }

  function loadCohorts() {
    const fy = state.fy ? '?fy=' + state.fy : '';
    setCohortLoading(true);
    return fetch('/crm/lybunt-sybunt-new/cohorts' + fy)
      .then(r => r.json())
      .then(data => {
        setCohortLoading(false);
        if (!cached) return;
        cached.cohorts = data.cohorts || [];
        drawCohortHeatmap(cached.cohorts);
      })
      .catch(err => {
        setCohortLoading(false);
        console.warn('[v2.cohorts]', err.message);
      });
  }

  function setTrendLoading(on) {
    const c = document.getElementById('ls2-trend-canvas');
    if (!c) return;
    c.parentElement.style.opacity = on ? '0.4' : '1';
    if (on) {
      c.parentElement.setAttribute('data-loading', 'Loading 5-FY trend…');
    } else {
      c.parentElement.removeAttribute('data-loading');
    }
  }
  function setCohortLoading(on) {
    const el = document.getElementById('ls2-cohort');
    if (!el) return;
    if (on) el.innerHTML = '<div style="font-size:12px;color:var(--color-text-secondary);padding:18px;text-align:center;"><i class="bi bi-hourglass-split"></i> Computing cohort recovery curve…</div>';
  }

  // Rerender helpers used by stage-2 callbacks
  function rerenderKpis(data) {
    // KPI cards include reactivated counter; just rebuild KPI section in place
    const content = document.getElementById('ls2-content');
    if (!content) return;
    // Quick-and-cheap: re-render the entire payload — render() is idempotent
    // and the table doesn't refetch since we pass cached state
    render(data);
  }
  function rerenderAdvancedFilters() {
    // Advanced-filters dropdowns refresh on render() via the fresh data — same
    // cheap path as rerenderKpis. Keeping the function for future selective
    // updates.
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  window._ls2CloseModal = function () {
    document.getElementById('ls2-modal').classList.remove('active');
  };
  function showModal(title, text, icon) {
    const m = document.getElementById('ls2-modal');
    document.getElementById('ls2-modal-title').textContent = title;
    document.getElementById('ls2-modal-text').textContent = text;
    if (icon) document.getElementById('ls2-modal-icon').innerHTML = '<i class="bi ' + icon + '"></i>';
    m.classList.add('active');
  }

  // Expose a couple of helpers used as inline callbacks
  window._ls2 = {
    setPage(n) { state.page = n; loadData(); },
    setTab(cat) { state.category = cat === 'all' ? null : cat; state.page = 1; loadData(); },
    setSort(sort) { state.sortBy = sort; state.page = 1; loadData(); },
    setSegment(seg) { state.segment = seg || null; state.page = 1; loadData(); },
    clearFilter(k) { state[k] = null; state.page = 1; loadData(); },
    clearAll() {
      Object.assign(state, {
        category: null, segment: null, yearsSince: null,
        gaveInFyStart: null, gaveInFyEnd: null, notInFyStart: null, notInFyEnd: null,
        minGift: null, maxGift: null, fundId: null, campaignId: null, appealId: null,
        constituentType: null, includeSuppressed: false, page: 1,
      });
      loadData();
    },
    toggleSuppressed() {
      state.includeSuppressed = !state.includeSuppressed;
      state.page = 1; loadData();
    },
    exportExcel() {
      const qs = new URLSearchParams();
      Object.keys(state).forEach(k => {
        if (state[k] == null || state[k] === '' || state[k] === false) return;
        qs.set(k, String(state[k]));
      });
      window.location.href = '/crm/lybunt-sybunt-new/export?' + qs.toString();
    },
    exportPdf() {
      const qs = new URLSearchParams();
      Object.keys(state).forEach(k => {
        if (state[k] == null || state[k] === '' || state[k] === false) return;
        qs.set(k, String(state[k]));
      });
      window.location.href = '/crm/lybunt-sybunt-new/pdf?' + qs.toString();
    },
    exportCsv() {
      if (!cached || !cached.topDonors) return;
      const headers = ['Donor', 'Category', 'Last Active FY', 'Last Active FY Giving',
        'Lifetime', 'Total Gifts', 'Distinct FYs', 'Years Lapsed',
        'Recapture Prob', 'Realistic Recovery', 'Suggested Ask', 'Priority', 'Last Gift'];
      const rows = cached.topDonors.map(d => [
        d.donor_name || '', d.category || '', d.last_active_fy || '',
        d.last_active_fy_giving || 0, d.lifetime_giving || 0, d.total_gifts || 0,
        d.distinct_fy_count || 0, d.years_lapsed || 0,
        d.recapture_prob || 0, d.realistic_recovery || 0, d.suggested_ask || 0,
        d.priority_score || 0,
        d.last_gift_date ? String(d.last_gift_date).split('T')[0] : '',
      ]);
      const escCsv = v => {
        const s = String(v == null ? '' : v).replace(/"/g, '""');
        return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) ? '"' + s + '"' : s;
      };
      const lines = [headers.join(',')];
      rows.forEach(r => lines.push(r.map(escCsv).join(',')));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'LYBUNT_NEW_' + (state.category || 'All') + (state.fy ? '_FY' + state.fy : '') + '.csv';
      a.click();
    },
    markContacted(constituentId, donorName) {
      const csrf = document.querySelector('meta[name="csrf-token"]');
      fetch('/crm/lybunt-sybunt-new/outreach', {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          csrf ? { 'CSRF-Token': csrf.getAttribute('content') } : {}
        ),
        body: JSON.stringify({ constituentId, actionType: 'contacted', channel: 'other' }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          // Update the row locally so the user sees instant feedback
          outreachStatus[constituentId] = {
            action_type: 'contacted',
            action_date: new Date().toISOString().slice(0, 10),
          };
          refreshOutreachBadges();
          showModal('Recorded',
            donorName + ' marked as contacted. This is logged and visible to your team.',
            'bi-check2-circle');
        })
        .catch(err => {
          showModal('Error', err.message, 'bi-exclamation-triangle');
        });
    },
    excludeDonor(constituentId, donorName) {
      fetch('/crm/lybunt-sybunt-new/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ constituentId, actionType: 'excluded', excludedUntilDays: 90 }),
      })
        .then(r => r.json())
        .then(() => {
          outreachStatus[constituentId] = { action_type: 'excluded', action_date: new Date().toISOString().slice(0, 10) };
          refreshOutreachBadges();
          showModal('Excluded', donorName + ' excluded from the work queue for 90 days.', 'bi-slash-circle');
        })
        .catch(err => showModal('Error', err.message, 'bi-exclamation-triangle'));
    },
    toggleMethodology() {
      const body = document.getElementById('ls2-methodology-body');
      const chev = document.querySelector('.ls2-method-chev');
      if (body.style.display === 'none') {
        body.style.display = 'block';
        chev.classList.add('open');
      } else {
        body.style.display = 'none';
        chev.classList.remove('open');
      }
    },
  };

  document.getElementById('ls2-methodology-toggle').addEventListener('click', window._ls2.toggleMethodology);

  // ---------------------------------------------------------------------------
  // Renderers — split into small functions per page section
  // ---------------------------------------------------------------------------
  function render(data) {
    buildFyPicker(data.fiscalYears, data.selectedFY);
    if (!data || !data.summary) {
      showContent('<div style="text-align:center;padding:40px;font-size:14px;color:var(--color-text-secondary);">' +
        'Select a fiscal year to see lapsed-donor analysis.</div>');
      return;
    }

    let html = '';
    html += renderPacing(data.pacing);
    html += renderActiveFilterChips();
    html += renderKpis(data);
    html += renderTrendContainer();
    html += renderCohortContainer();
    html += renderBandsContainer();
    html += renderSegmentPresets();
    html += renderAdvancedFilters(data.filterOptions);
    html += renderDonorTable(data);

    showContent(html, function () {
      drawTrendChart(data.trend);
      drawCohortHeatmap(data.cohorts);
      drawBandsChart(data.bands, data.summary);
      bindSegmentClicks();
      bindAdvancedFilters();
      bindTableSort();
      loadOutreachStatus(data.topDonors || []);
    });

    renderFooter(data);
  }

  // Load per-donor outreach status for the current page (bulk, one request)
  function loadOutreachStatus(donors) {
    const ids = donors.map(d => d.constituent_id).filter(Boolean);
    if (!ids.length) return;
    fetch('/crm/lybunt-sybunt-new/outreach/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ constituentIds: ids }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data || !data.status) return;
        outreachStatus = Object.assign({}, outreachStatus, data.status);
        refreshOutreachBadges();
      })
      .catch(err => console.warn('[outreach.status]', err.message));
  }

  // Update outreach badges in the currently-rendered donor table in-place
  function refreshOutreachBadges() {
    document.querySelectorAll('[data-outreach-badge]').forEach(el => {
      const cid = el.getAttribute('data-outreach-badge');
      const st = outreachStatus[cid];
      if (st) el.innerHTML = renderOutreachBadge(st);
      else el.innerHTML = '';
    });
  }

  function renderOutreachBadge(st) {
    if (!st) return '';
    const map = {
      contacted: { bg: '#dcfce7', color: '#166534', label: 'Contacted', icon: 'bi-check2-circle' },
      queued: { bg: '#dbeafe', color: '#1e40af', label: 'Queued', icon: 'bi-list-check' },
      excluded: { bg: '#f3f4f6', color: '#6b7280', label: 'Excluded', icon: 'bi-slash-circle' },
      reactivated: { bg: '#dcfce7', color: '#166534', label: 'Reactivated', icon: 'bi-arrow-repeat' },
      note: { bg: '#fef3c7', color: '#92400e', label: 'Note', icon: 'bi-sticky' },
    };
    const m = map[st.action_type] || map.note;
    const when = st.action_date ? humanDate(st.action_date) : '';
    return '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:600;background:' + m.bg + ';color:' + m.color + ';">' +
      '<i class="bi ' + m.icon + '"></i> ' + m.label + (when ? ' · ' + when : '') + '</span>';
  }

  function humanDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const days = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    if (days < 365) return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
  }

  // ---------------------------------------------------------------------------
  // FY picker
  // ---------------------------------------------------------------------------
  function buildFyPicker(fiscalYears, selectedFy) {
    const picker = document.getElementById('fy-picker');
    if (!picker || !fiscalYears || !fiscalYears.length) return;
    state.fy = selectedFy || fiscalYears[0].fy;
    let opts = '';
    fiscalYears.forEach(fy => {
      opts += '<option value="' + fy.fy + '"' + (state.fy == fy.fy ? ' selected' : '') + '>FY' + fy.fy + '</option>';
    });
    picker.innerHTML = '<div class="fy-select-wrap">' +
      '<label><i class="bi bi-calendar3" style="margin-right:4px;"></i>FY</label>' +
      '<select id="ls2-fy-select" aria-label="Fiscal year">' + opts + '</select></div>';
    picker.style.display = 'block';
    const sel = document.getElementById('ls2-fy-select');
    sel.addEventListener('change', function () {
      state.fy = this.value;
      state.page = 1;
      loadData();
    });
  }

  // ---------------------------------------------------------------------------
  // Content mount / first-paint transition
  // ---------------------------------------------------------------------------
  function showContent(html, cb) {
    const loader = document.getElementById('ls2-loading');
    const content = document.getElementById('ls2-content');
    if (loader.style.display !== 'none') {
      loader.classList.add('fade-out');
      setTimeout(() => {
        loader.style.display = 'none';
        content.innerHTML = html;
        content.style.display = 'block';
        if (cb) cb();
      }, 350);
    } else {
      content.innerHTML = html;
      content.style.display = 'block';
      if (cb) cb();
    }
  }

  // Kick off — load the FY list only (cheap), then show the FY picker as the
  // primary call-to-action. We do NOT auto-fetch the heavy lapsed cohort on
  // first paint — the user picks a FY first. This protects the small Postgres
  // instance from running an expensive analysis nobody asked for, and gives
  // the user explicit control over when the work starts.
  queryToState();
  if (state.fy) {
    // URL has a FY (deep link / shared link) — proceed straight to load
    loadData();
  } else {
    // First-time visit: render an empty-state FY picker
    renderFyPickerEmptyState();
  }

  function renderFyPickerEmptyState() {
    const loader = document.getElementById('ls2-loading');
    const content = document.getElementById('ls2-content');
    fetch('/crm/lybunt-sybunt-new/data?fy=__listonly__&limit=1', { method: 'HEAD' })
      .catch(() => {}); // warm session — non-blocking
    // Use the secondary endpoint to get the fiscal years list cheaply
    fetch('/crm/lybunt-sybunt-new/fiscal-years')
      .then(r => r.json())
      .then(data => {
        loader.style.display = 'none';
        content.style.display = 'block';
        content.innerHTML = renderEmptyState(data.fiscalYears || []);
        bindEmptyStatePicker();
      })
      .catch(err => {
        loader.style.display = 'none';
        content.style.display = 'block';
        content.innerHTML = '<div class="alert-card danger" style="margin:24px 0;padding:16px;border-radius:10px;background:#FCEBEB;color:#dc2626;">' +
          'Could not load fiscal years: ' + esc(err.message) + '</div>';
      });
  }

  function renderEmptyState(fiscalYears) {
    let html = '<div style="max-width:520px;margin:60px auto;text-align:center;padding:40px 24px;background:var(--color-background-secondary);border:1px solid var(--color-border-primary);border-radius:16px;">';
    html += '<div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#1A223D,#3434D6);display:inline-flex;align-items:center;justify-content:center;font-size:30px;color:white;margin-bottom:20px;">' +
      '<i class="bi bi-calendar3-event"></i></div>';
    html += '<h2 style="font-size:22px;font-weight:700;color:var(--color-text-primary);margin:0 0 10px;">Choose a fiscal year to begin</h2>';
    html += '<p style="font-size:14px;color:var(--color-text-secondary);margin:0 0 24px;line-height:1.6;">' +
      'LYBUNT / SYBUNT analysis compares lapsed donors against the fiscal year you\'re working in. ' +
      'Pick one to start — the dashboard will compute the at-risk cohort, recovery estimates, and your work queue.' +
      '</p>';
    if (!fiscalYears.length) {
      html += '<div style="font-size:13px;color:var(--color-text-secondary);">No fiscal years found in your CRM data yet.</div>';
    } else {
      html += '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-bottom:20px;">';
      fiscalYears.slice(0, 8).forEach((fy, i) => {
        const isPrimary = i === 0;
        html += '<button class="ls2-empty-fy-btn ' + (isPrimary ? 'fr-btn' : 'fr-btn-secondary') +
          '" data-fy="' + fy.fy + '" style="padding:10px 22px;font-size:14px;font-weight:' + (isPrimary ? '700' : '600') + ';">' +
          'FY' + fy.fy + '</button>';
      });
      html += '</div>';
      if (fiscalYears.length > 8) {
        html += '<div style="margin-top:8px;"><label style="font-size:11px;color:var(--color-text-secondary);font-weight:600;display:block;margin-bottom:4px;">Or pick an older FY</label>' +
          '<select id="ls2-empty-fy-select" style="font-size:13px;padding:6px 12px;border:1px solid var(--color-border-primary);border-radius:8px;">' +
          '<option value="">Select…</option>';
        fiscalYears.slice(8).forEach(fy => {
          html += '<option value="' + fy.fy + '">FY' + fy.fy + '</option>';
        });
        html += '</select></div>';
      }
    }
    html += '<div style="margin-top:20px;font-size:11px;color:var(--color-text-tertiary);">' +
      '<i class="bi bi-info-circle"></i> Tip: bookmark or share the URL after picking a FY — it carries your selection.' +
      '</div>';
    html += '</div>';
    return html;
  }

  function bindEmptyStatePicker() {
    document.querySelectorAll('.ls2-empty-fy-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        state.fy = this.getAttribute('data-fy');
        // Show the loading shell again before the first real fetch
        const loader = document.getElementById('ls2-loading');
        const content = document.getElementById('ls2-content');
        content.style.display = 'none';
        loader.classList.remove('fade-out');
        loader.style.display = 'flex';
        loader.querySelector('.ls2-loading-text').textContent = 'Computing FY' + state.fy + ' lapsed-donor analysis…';
        loadData();
      });
    });
    const sel = document.getElementById('ls2-empty-fy-select');
    if (sel) sel.addEventListener('change', function () {
      if (!this.value) return;
      state.fy = this.value;
      const loader = document.getElementById('ls2-loading');
      const content = document.getElementById('ls2-content');
      content.style.display = 'none';
      loader.classList.remove('fade-out');
      loader.style.display = 'flex';
      loader.querySelector('.ls2-loading-text').textContent = 'Computing FY' + state.fy + ' lapsed-donor analysis…';
      loadData();
    });
  }

  // ---------------------------------------------------------------------------
  // Pacing banner
  // ---------------------------------------------------------------------------
  function renderPacing(pacing) {
    // Injected into a static holder at the top so it doesn't flicker on filter
    // changes. We still recompute on every render for freshness.
    const holder = document.getElementById('ls2-pacing');
    if (!holder) return '';
    if (!pacing || pacing.current.priorYearDonors === 0) {
      holder.innerHTML = '';
      return '';
    }
    const pct = (pacing.pctIntoFy * 100).toFixed(0);
    const curRate = (pacing.current.renewalRate * 100).toFixed(0);
    const priorRate = (pacing.priorYearSamePoint.renewalRate * 100).toFixed(0);
    const delta = pacing.paceDeltaPp;
    const deltaColor = delta >= 0 ? '#16a34a' : '#dc2626';
    const deltaIcon = delta >= 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
    const msg = delta >= 0
      ? 'You\'re pacing <strong>ahead</strong> of last year\'s renewal curve.'
      : 'You\'re pacing <strong>behind</strong> last year\'s renewal curve.';
    holder.innerHTML =
      '<div class="fr-card" style="margin-bottom:16px;border-left:4px solid ' + deltaColor + ';">' +
      '<div class="fr-card-body" style="padding:14px 18px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:center;">' +
      '<div>' +
      '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">' +
      '<i class="bi bi-stopwatch"></i> You are <strong>' + pct + '%</strong> through FY' + pacing.currentFY +
      ' (' + pacing.daysIntoFy + ' / ' + pacing.fyLengthDays + ' days)' +
      '</div>' +
      '<div style="font-size:13px;color:var(--color-text-primary);">' + msg + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:22px;">' +
      '<div><div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;">Renewal rate this FY</div>' +
      '<div style="font-size:20px;font-weight:700;color:var(--color-text-primary);">' + curRate + '%</div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);">' + fmt(pacing.current.renewedSoFar) + ' of ' + fmt(pacing.current.priorYearDonors) + '</div></div>' +
      '<div><div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;">Prior FY same point</div>' +
      '<div style="font-size:20px;font-weight:700;color:var(--color-text-secondary);">' + priorRate + '%</div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);">' + fmt(pacing.priorYearSamePoint.renewedByThen) + ' of ' + fmt(pacing.priorYearSamePoint.priorYearDonors) + '</div></div>' +
      '<div><div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;">Pace delta</div>' +
      '<div style="font-size:20px;font-weight:700;color:' + deltaColor + ';"><i class="bi ' + deltaIcon + '"></i> ' + fmtPp(delta) + '</div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);">vs. last FY</div></div>' +
      '</div></div></div>';
    return ''; // already injected
  }

  // ---------------------------------------------------------------------------
  // Active filter chip bar
  // ---------------------------------------------------------------------------
  function renderActiveFilterChips() {
    const chips = [];
    if (state.category) chips.push({ k: 'category', label: state.category });
    if (state.segment) chips.push({ k: 'segment', label: segmentLabel(state.segment) });
    if (state.yearsSince) chips.push({ k: 'yearsSince', label: state.yearsSince + ' yrs lapsed' });
    if (state.minGift != null && state.minGift !== '') chips.push({ k: 'minGift', label: '>= $' + fmt(state.minGift) });
    if (state.maxGift != null && state.maxGift !== '') chips.push({ k: 'maxGift', label: '<= $' + fmt(state.maxGift) });
    if (state.fundId) chips.push({ k: 'fundId', label: 'Fund: ' + state.fundId });
    if (state.campaignId) chips.push({ k: 'campaignId', label: 'Campaign: ' + state.campaignId });
    if (state.appealId) chips.push({ k: 'appealId', label: 'Appeal: ' + state.appealId });
    if (state.constituentType) chips.push({ k: 'constituentType', label: state.constituentType });
    if (state.gaveInFyStart && state.gaveInFyEnd) chips.push({ k: 'gaveInFyStart', label: 'Gave FY' + state.gaveInFyStart + '–FY' + state.gaveInFyEnd });
    if (state.notInFyStart && state.notInFyEnd) chips.push({ k: 'notInFyStart', label: 'Not FY' + state.notInFyStart + '–FY' + state.notInFyEnd });
    if (state.includeSuppressed) chips.push({ k: 'includeSuppressed', label: 'Incl. suppressed' });

    if (!chips.length) return '';
    let html = '<div class="ls2-chip-bar" style="margin-bottom:14px;">';
    html += '<span style="font-size:11px;color:var(--color-text-secondary);font-weight:600;text-transform:uppercase;margin-right:4px;">Filters:</span>';
    chips.forEach(c => {
      html += '<span class="ls2-active-chip">' + esc(c.label) +
        '<button onclick="window._ls2.clearFilter(\'' + c.k + (c.k === 'gaveInFyStart' ? '\');window._ls2.clearFilter(\'gaveInFyEnd' : '') + (c.k === 'notInFyStart' ? '\');window._ls2.clearFilter(\'notInFyEnd' : '') + '\')" aria-label="Remove">×</button></span>';
    });
    html += '<button onclick="window._ls2.clearAll()" style="background:transparent;border:none;color:var(--color-brand-blue);font-size:12px;cursor:pointer;font-weight:600;margin-left:6px;">Clear all</button>';
    html += '</div>';
    return html;
  }

  function segmentLabel(s) {
    const m = {
      'recently-lapsed': 'Recently Lapsed',
      'long-lapsed': 'Long Lapsed (5+ yrs)',
      'high-value-lapsed': 'High-Value Lapsed ($1K+)',
      'frequent-gone-quiet': 'Frequent Donors Gone Quiet',
      'one-and-done': 'One-and-Done',
      'top-priority': 'Top Priority',
    };
    return m[s] || s;
  }

  // ---------------------------------------------------------------------------
  // KPI cards
  // ---------------------------------------------------------------------------
  function renderKpis(data) {
    const s = data.summary;
    const r = data.reactivated || { count: 0, revenue: 0 };

    let html = '<div class="ls2-kpi-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:20px;">';

    // Foregone revenue
    html += '<div class="fr-card" style="border-left:4px solid var(--color-brand-navy);padding:16px 18px;">' +
      '<div class="ls2-kpi-label" title="Sum of each lapsed donor\'s most recent active FY giving. Represents the recurring annual amount the org foregoes each year these donors are not re-engaged.">' +
      'Annual Foregone Revenue' +
      '<i class="bi bi-info-circle" style="font-size:10px;margin-left:4px;opacity:.6;"></i></div>' +
      '<div class="ls2-kpi-value">' + fmtD(s.foregoneRevenue) + '</div>' +
      '<div class="ls2-kpi-sub"><strong>' + fmt(s.totalDonors) + '</strong> lapsed donors · avg ' + fmtD(s.avgAnnualGift) + '</div>' +
      '</div>';

    // Realistic recovery
    html += '<div class="fr-card" style="border-left:4px solid #16a34a;padding:16px 18px;">' +
      '<div class="ls2-kpi-label" title="Probability-weighted recovery estimate using industry benchmarks (25% LYBUNT / 12% 2-3 yr / 6% 4-5 yr / 2% 5+ yr).">' +
      'Realistic Recovery' +
      '<i class="bi bi-info-circle" style="font-size:10px;margin-left:4px;opacity:.6;"></i></div>' +
      '<div class="ls2-kpi-value" style="color:#16a34a;">' + fmtD(s.realisticRecovery) + '</div>' +
      '<div class="ls2-kpi-sub">target with a focused reactivation campaign</div>' +
      '</div>';

    // LYBUNT
    html += '<div class="fr-card" style="border-left:4px solid #dc2626;padding:16px 18px;">' +
      '<div class="ls2-kpi-label">LYBUNT</div>' +
      '<div class="ls2-kpi-value" style="color:#dc2626;">' + fmt(s.lybunt.donors) + '</div>' +
      '<div class="ls2-kpi-sub">' + fmtD(s.lybunt.foregone) + ' foregone · <strong>' + fmtD(s.lybunt.recovery) + '</strong> recoverable</div>' +
      '</div>';

    // SYBUNT
    html += '<div class="fr-card" style="border-left:4px solid #d97706;padding:16px 18px;">' +
      '<div class="ls2-kpi-label">SYBUNT</div>' +
      '<div class="ls2-kpi-value" style="color:#d97706;">' + fmt(s.sybunt.donors) + '</div>' +
      '<div class="ls2-kpi-sub">' + fmtD(s.sybunt.foregone) + ' foregone · <strong>' + fmtD(s.sybunt.recovery) + '</strong> recoverable</div>' +
      '</div>';

    html += '</div>';

    // Secondary row: reactivated wins + suppressed count
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:20px;">';
    html += '<div class="fr-card" style="padding:14px 18px;border-left:4px solid #16a34a;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
      '<i class="bi bi-person-check-fill" style="font-size:22px;color:#16a34a;"></i>' +
      '<div>' +
      '<div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;font-weight:600;">Reactivated this FY</div>' +
      '<div style="font-size:18px;font-weight:700;color:#16a34a;">' + fmt(r.count) + ' donors · ' + fmtD(r.revenue) + '</div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);">Previously lapsed 2+ yrs, gave in FY' + data.currentFY + '</div>' +
      '</div></div></div>';

    if (s.suppressedDonors > 0 && !state.includeSuppressed) {
      html += '<div class="fr-card" style="padding:14px 18px;border-left:4px solid #94a3b8;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<i class="bi bi-shield-slash" style="font-size:22px;color:#64748b;"></i>' +
        '<div>' +
        '<div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;font-weight:600;">Hidden suppressed donors</div>' +
        '<div style="font-size:18px;font-weight:700;">' + fmt(s.suppressedDonors) + '</div>' +
        '<div style="font-size:11px;"><a href="#" onclick="event.preventDefault();window._ls2.toggleSuppressed();" style="color:var(--color-brand-blue);">Show suppressed →</a></div>' +
        '</div></div></div>';
    }

    html += '</div>';
    return html;
  }

  // ---------------------------------------------------------------------------
  // Trend chart placeholder (canvas; filled later via Chart.js)
  // ---------------------------------------------------------------------------
  function renderTrendContainer() {
    return '<div class="fr-card" style="margin-bottom:20px;"><div class="fr-card-body">' +
      '<div class="section-title" style="margin-bottom:12px;"><i class="bi bi-graph-up"></i> 5-FY Lapsed-Donor Trend</div>' +
      '<div style="height:240px;"><canvas id="ls2-trend-canvas"></canvas></div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);margin-top:8px;">' +
      'Shows LYBUNT + SYBUNT counts per FY and the foregone revenue trend. Use this to see whether lapsing is getting better or worse over time.' +
      '</div>' +
      '</div></div>';
  }

  // ---------------------------------------------------------------------------
  // Cohort analysis — historical recovery curves
  // ---------------------------------------------------------------------------
  function renderCohortContainer() {
    return '<div class="fr-card" style="margin-bottom:20px;"><div class="fr-card-body">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<div class="section-title" style="margin:0;"><i class="bi bi-grid-3x3-gap"></i> Your Historical Recapture Curve</div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);">Benchmark: 25% / 12% / 6% / 2%</div>' +
      '</div>' +
      '<div id="ls2-cohort"></div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);margin-top:8px;">' +
      'For each past FY\'s cohort: % of lapsed donors who returned within N years. Compare your actual recovery curve against the benchmark probabilities used in the Realistic Recovery KPI.' +
      '</div>' +
      '</div></div>';
  }

  function drawCohortHeatmap(cohorts) {
    const holder = document.getElementById('ls2-cohort');
    if (!holder) return;
    if (!cohorts || !cohorts.length) {
      holder.innerHTML = '<div style="font-size:12px;color:var(--color-text-secondary);padding:10px;">Not enough historical data for a cohort recovery curve. Comes online after 2+ years of gift history.</div>';
      return;
    }
    // Determine column set: maximum years after lapse we have
    const maxYears = cohorts.reduce((a, c) => Math.max(a, c.recoveryPoints.length), 0);
    if (maxYears === 0) {
      holder.innerHTML = '<div style="font-size:12px;color:var(--color-text-secondary);padding:10px;">No recovery data yet for your cohorts.</div>';
      return;
    }

    const benchmarkCum = [0.25, 0.37, 0.43, 0.45, 0.47]; // LYBUNT + SYBUNT cumulative benchmark
    function cellColor(pct) {
      // 0% = light, 50%+ = deep green
      const c = Math.min(100, Math.round(pct * 200));
      return 'rgba(22,163,74,' + (0.08 + c / 300) + ')';
    }

    let html = '<div style="overflow-x:auto;"><table class="fr-table" style="width:100%;font-size:11px;min-width:600px;"><thead><tr>' +
      '<th scope="col">Cohort FY</th>' +
      '<th scope="col" style="text-align:right;">Active donors</th>' +
      '<th scope="col" style="text-align:right;">Lapsed after 1 yr</th>' +
      '<th scope="col" style="text-align:right;">Lapse rate</th>';
    for (let y = 1; y <= maxYears; y++) {
      html += '<th scope="col" style="text-align:center;" title="Cumulative % of this cohort\'s lapsed donors who returned within ' + y + ' year(s) of lapsing">' +
        y + 'yr recovery</th>';
    }
    html += '</tr></thead><tbody>';

    cohorts.forEach(c => {
      html += '<tr>';
      html += '<td style="font-weight:600;">FY' + c.cohortFy + '</td>';
      html += '<td style="text-align:right;">' + fmt(c.cohortSize) + '</td>';
      html += '<td style="text-align:right;">' + fmt(c.lybuntSize) + '</td>';
      html += '<td style="text-align:right;">' + fmtPct(c.lybuntRate) + '</td>';
      for (let y = 1; y <= maxYears; y++) {
        const p = c.recoveryPoints[y - 1];
        if (!p) { html += '<td style="text-align:center;color:var(--color-text-tertiary);">—</td>'; continue; }
        const pct = p.cumulativePct;
        const bench = benchmarkCum[y - 1];
        const vsBench = bench != null ? (pct - bench) : null;
        const vsBenchStr = vsBench == null ? '' :
          ' <span style="font-size:10px;color:' + (vsBench >= 0 ? '#16a34a' : '#dc2626') + ';">' +
          (vsBench >= 0 ? '↑' : '↓') + Math.abs(vsBench * 100).toFixed(0) + 'pp</span>';
        html += '<td style="text-align:center;background:' + cellColor(pct) + ';">' +
          '<strong>' + fmtPct(pct) + '</strong> (' + fmt(p.cumulativeRecovered) + ')' + vsBenchStr +
          '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    holder.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Bands container
  // ---------------------------------------------------------------------------
  function renderBandsContainer() {
    return '<div class="fr-card" style="margin-bottom:20px;"><div class="fr-card-body">' +
      '<div class="section-title" style="margin-bottom:12px;"><i class="bi bi-bar-chart"></i> Foregone Revenue by Giving Band</div>' +
      '<div id="ls2-bands"></div>' +
      '<div style="font-size:11px;color:var(--color-text-secondary);margin-top:8px;">' +
      'Band = donor\'s last active FY giving. Use this to spot the capacity concentration of your lapsed base.' +
      '</div>' +
      '</div></div>';
  }

  // ---------------------------------------------------------------------------
  // Segment presets
  // ---------------------------------------------------------------------------
  function renderSegmentPresets() {
    const segs = [
      { id: '', label: 'All Lapsed', icon: 'bi-people' },
      { id: 'top-priority', label: 'Top Priority', icon: 'bi-trophy' },
      { id: 'recently-lapsed', label: 'Recently Lapsed', icon: 'bi-clock' },
      { id: 'long-lapsed', label: 'Long Lapsed (5+ yrs)', icon: 'bi-hourglass-bottom' },
      { id: 'high-value-lapsed', label: 'High-Value Lapsed ($1K+)', icon: 'bi-gem' },
      { id: 'frequent-gone-quiet', label: 'Frequent Donors Gone Quiet', icon: 'bi-volume-mute' },
      { id: 'one-and-done', label: 'One-and-Done', icon: 'bi-1-circle' },
    ];
    let html = '<div class="fr-card" style="margin-bottom:20px;"><div class="fr-card-body">' +
      '<div class="section-title" style="margin-bottom:10px;"><i class="bi bi-funnel"></i> Quick Segments</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
    segs.forEach(s => {
      const active = (state.segment || '') === s.id;
      html += '<button class="fr-btn ' + (active ? '' : 'fr-btn-secondary') + ' ls2-seg-btn" data-seg="' + s.id + '" style="padding:5px 14px;font-size:12px;' + (active ? 'font-weight:700;' : '') + '">' +
        '<i class="bi ' + s.icon + '" style="margin-right:4px;"></i>' + s.label + '</button>';
    });
    html += '</div></div></div>';
    return html;
  }

  function bindSegmentClicks() {
    document.querySelectorAll('.ls2-seg-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const s = this.getAttribute('data-seg');
        state.segment = s || null;
        state.page = 1;
        loadData();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Advanced filters
  // ---------------------------------------------------------------------------
  function renderAdvancedFilters(opts) {
    opts = opts || { funds: [], campaigns: [], appeals: [], constituentTypes: [] };
    const fySince = [
      { v: '', label: 'Any' },
      { v: '1', label: '~1 year ago (LYBUNT)' },
      { v: '2-3', label: '2–3 years ago' },
      { v: '4-5', label: '4–5 years ago' },
      { v: '5+', label: '5+ years ago' },
    ];
    let html = '<div class="fr-card" style="margin-bottom:20px;"><div class="fr-card-body">' +
      '<details' + (hasAdvanced() ? ' open' : '') + '><summary style="font-size:14px;font-weight:600;color:var(--color-text-primary);cursor:pointer;user-select:none;">' +
      '<i class="bi bi-sliders" style="margin-right:6px;"></i>Advanced filters</summary>' +
      '<div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;align-items:end;">';

    // Years since
    html += filterField('Years Since Last Gift',
      selectHtml('ls2-ys', fySince.map(f => ({ v: f.v, label: f.label, selected: state.yearsSince === f.v || (!state.yearsSince && f.v === '') }))));

    // Min/Max gift
    html += filterField('Min Annual $', '<input type="number" id="ls2-min-gift" value="' + (state.minGift == null ? '' : state.minGift) + '" placeholder="e.g. 100" style="font-size:12px;padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:6px;width:100%;">');
    html += filterField('Max Annual $', '<input type="number" id="ls2-max-gift" value="' + (state.maxGift == null ? '' : state.maxGift) + '" placeholder="e.g. 100000" style="font-size:12px;padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:6px;width:100%;">');

    // Fund / Campaign / Appeal / Constituent type
    if (opts.funds && opts.funds.length) {
      html += filterField('Fund', selectHtml('ls2-fund',
        [{ v: '', label: 'All funds' }].concat(opts.funds.slice(0, 80).map(f => ({
          v: f.id, label: (f.label || f.id) + ' (' + f.gift_count + ')', selected: state.fundId === f.id,
        })))));
    }
    if (opts.campaigns && opts.campaigns.length) {
      html += filterField('Campaign', selectHtml('ls2-campaign',
        [{ v: '', label: 'All campaigns' }].concat(opts.campaigns.slice(0, 80).map(c => ({
          v: c.id, label: (c.label || c.id) + ' (' + c.gift_count + ')', selected: state.campaignId === c.id,
        })))));
    }
    if (opts.appeals && opts.appeals.length) {
      html += filterField('Appeal', selectHtml('ls2-appeal',
        [{ v: '', label: 'All appeals' }].concat(opts.appeals.slice(0, 80).map(a => ({
          v: a.id, label: (a.label || a.id) + ' (' + a.gift_count + ')', selected: state.appealId === a.id,
        })))));
    }
    if (opts.constituentTypes && opts.constituentTypes.length > 1) {
      html += filterField('Donor Type', selectHtml('ls2-ctype',
        [{ v: '', label: 'All types' }].concat(opts.constituentTypes.map(t => ({
          v: t.id, label: t.id + ' (' + t.gift_count + ')', selected: state.constituentType === t.id,
        })))));
    }

    // Custom FY ranges
    html += '<div><label style="font-size:11px;font-weight:600;color:var(--color-text-secondary);display:block;margin-bottom:4px;">Gave During FY Range</label>' +
      '<div style="display:flex;gap:4px;align-items:center;">' +
      '<input type="number" id="ls2-gave-start" value="' + (state.gaveInFyStart || '') + '" placeholder="Start" style="width:70px;font-size:12px;padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:6px;">' +
      '<span style="font-size:11px;color:var(--color-text-secondary);">to</span>' +
      '<input type="number" id="ls2-gave-end" value="' + (state.gaveInFyEnd || '') + '" placeholder="End" style="width:70px;font-size:12px;padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:6px;"></div></div>';

    html += '<div><label style="font-size:11px;font-weight:600;color:var(--color-text-secondary);display:block;margin-bottom:4px;">Did NOT Give During FY Range</label>' +
      '<div style="display:flex;gap:4px;align-items:center;">' +
      '<input type="number" id="ls2-notin-start" value="' + (state.notInFyStart || '') + '" placeholder="Start" style="width:70px;font-size:12px;padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:6px;">' +
      '<span style="font-size:11px;color:var(--color-text-secondary);">to</span>' +
      '<input type="number" id="ls2-notin-end" value="' + (state.notInFyEnd || '') + '" placeholder="End" style="width:70px;font-size:12px;padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:6px;"></div></div>';

    html += '</div>';
    html += '<div style="display:flex;gap:8px;margin-top:14px;">' +
      '<button id="ls2-apply" class="fr-btn" style="padding:5px 16px;font-size:12px;"><i class="bi bi-funnel-fill" style="margin-right:4px;"></i>Apply filters</button>' +
      '<button id="ls2-reset" class="fr-btn fr-btn-secondary" style="padding:5px 12px;font-size:12px;">Reset</button>' +
      '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text-secondary);margin-left:auto;">' +
      '<input type="checkbox" id="ls2-incl-sup"' + (state.includeSuppressed ? ' checked' : '') + '> Include suppressed donors</label>' +
      '</div>';
    html += '</details></div></div>';
    return html;
  }

  function filterField(label, inputHtml) {
    return '<div><label style="font-size:11px;font-weight:600;color:var(--color-text-secondary);display:block;margin-bottom:4px;">' + label + '</label>' + inputHtml + '</div>';
  }
  function selectHtml(id, opts) {
    let h = '<select id="' + id + '" style="font-size:12px;padding:5px 8px;border:1px solid var(--color-border-primary);border-radius:6px;background:white;width:100%;">';
    opts.forEach(o => {
      h += '<option value="' + esc(o.v) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    });
    h += '</select>';
    return h;
  }
  function hasAdvanced() {
    return !!(state.yearsSince || state.minGift || state.maxGift || state.fundId
      || state.campaignId || state.appealId || state.constituentType
      || state.gaveInFyStart || state.notInFyStart || state.includeSuppressed);
  }

  function bindAdvancedFilters() {
    const apply = document.getElementById('ls2-apply');
    if (apply) apply.addEventListener('click', () => {
      const v = id => { const el = document.getElementById(id); return el ? el.value : null; };
      state.yearsSince = v('ls2-ys') || null;
      state.minGift = v('ls2-min-gift') || null;
      state.maxGift = v('ls2-max-gift') || null;
      state.fundId = v('ls2-fund') || null;
      state.campaignId = v('ls2-campaign') || null;
      state.appealId = v('ls2-appeal') || null;
      state.constituentType = v('ls2-ctype') || null;
      state.gaveInFyStart = v('ls2-gave-start') || null;
      state.gaveInFyEnd = v('ls2-gave-end') || null;
      state.notInFyStart = v('ls2-notin-start') || null;
      state.notInFyEnd = v('ls2-notin-end') || null;
      const inc = document.getElementById('ls2-incl-sup');
      state.includeSuppressed = inc ? inc.checked : false;
      state.page = 1;
      loadData();
    });
    const reset = document.getElementById('ls2-reset');
    if (reset) reset.addEventListener('click', () => window._ls2.clearAll());
  }

  // ---------------------------------------------------------------------------
  // Donor table — the work queue
  // ---------------------------------------------------------------------------
  function renderDonorTable(data) {
    const donors = data.topDonors || [];
    const total = data.topDonorsTotal || 0;
    const totalPages = data.topDonorsTotalPages || 1;
    const page = data.topDonorsPage || 1;
    const limit = data.topDonorsLimit || 50;
    const offset = (page - 1) * limit;

    const lyTot = data.summary.lybunt.donors || 0;
    const syTot = data.summary.sybunt.donors || 0;

    let html = '<div class="fr-card"><div class="fr-card-body">';

    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:4px;">';
    html += '<div class="section-title">Donors to Reactivate — Work Queue</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    html += '<select id="ls2-sort" style="font-size:12px;padding:4px 8px;border:1px solid var(--color-border-primary);border-radius:6px;" aria-label="Sort by">';
    const sorts = [
      { v: 'priority', label: 'Sort: Priority' },
      { v: 'recovery', label: 'Sort: Realistic Recovery' },
      { v: 'revenue', label: 'Sort: Annual Giving $' },
      { v: 'lifetime', label: 'Sort: Lifetime Giving' },
      { v: 'recency', label: 'Sort: Last Gift (newest)' },
      { v: 'years_lapsed', label: 'Sort: Years Lapsed' },
    ];
    sorts.forEach(s => {
      html += '<option value="' + s.v + '"' + (state.sortBy === s.v ? ' selected' : '') + '>' + s.label + '</option>';
    });
    html += '</select>';
    html += '<button onclick="window._ls2.exportPdf()" class="fr-btn fr-btn-secondary" style="padding:2px 10px;font-size:11px;"><i class="bi bi-file-earmark-pdf"></i> PDF</button>';
    html += '<button onclick="window._ls2.exportExcel()" class="fr-btn fr-btn-secondary" style="padding:2px 10px;font-size:11px;"><i class="bi bi-file-earmark-spreadsheet"></i> Excel</button>';
    html += '<button onclick="window._ls2.exportCsv()" class="fr-btn fr-btn-secondary" style="padding:2px 10px;font-size:11px;"><i class="bi bi-download"></i> CSV</button>';
    html += '</div></div>';

    // Tabs
    html += '<div style="margin:12px 0 8px;border-bottom:1px solid var(--color-border-primary);">';
    html += '<span class="ls2-tab' + (!state.category ? ' active' : '') + '" onclick="window._ls2.setTab(\'all\')">All (' + fmt(lyTot + syTot) + ')</span>';
    html += '<span class="ls2-tab' + (state.category === 'LYBUNT' ? ' active' : '') + '" onclick="window._ls2.setTab(\'LYBUNT\')">LYBUNT (' + fmt(lyTot) + ')</span>';
    html += '<span class="ls2-tab' + (state.category === 'SYBUNT' ? ' active' : '') + '" onclick="window._ls2.setTab(\'SYBUNT\')">SYBUNT (' + fmt(syTot) + ')</span>';
    html += '</div>';

    if (!donors.length) {
      html += '<div style="padding:24px;text-align:center;color:var(--color-text-secondary);font-size:13px;">' +
        'No donors match the current filters. Try clearing filters or picking a different FY.</div>';
      html += '</div></div>';
      return html;
    }

    html += '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px;">' +
      'Showing ' + fmt(offset + 1) + '–' + fmt(Math.min(offset + donors.length, total)) +
      ' of ' + fmt(total) + ' donors</div>';

    html += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">' +
      '<table class="fr-table" style="width:100%;font-size:12px;"><thead><tr>' +
      '<th scope="col">#</th>' +
      '<th scope="col">Donor</th>' +
      '<th scope="col">Type</th>' +
      '<th scope="col" style="text-align:center;">Priority</th>' +
      '<th scope="col" style="text-align:right;">Last Active FY Giving</th>' +
      '<th scope="col" style="text-align:right;">Recovery</th>' +
      '<th scope="col" style="text-align:right;">Suggested Ask</th>' +
      '<th scope="col" style="text-align:right;">Lifetime</th>' +
      '<th scope="col" style="text-align:center;">Years Lapsed</th>' +
      '<th scope="col">Last Gift</th>' +
      '<th scope="col">Outreach</th>' +
      '</tr></thead><tbody>';

    donors.forEach((d, i) => {
      const cls = d.category === 'LYBUNT' ? 'ls2-pill-lybunt' : 'ls2-pill-sybunt';
      const pri = d.priority_score || 0;
      const suppBadge = d.is_suppressed ? '<span class="ls2-suppression-badge" title="Suppressed">SUP</span>' : '';
      const name = esc(d.donor_name || d.constituent_id || 'Unknown');
      html += '<tr>';
      html += '<td>' + (offset + i + 1) + '</td>';
      html += '<td><a href="/crm/donor/' + encodeURIComponent(d.constituent_id) + '">' + name + '</a>' + suppBadge;
      if (d.constituent_type) html += '<div style="font-size:10px;color:var(--color-text-tertiary);">' + esc(d.constituent_type) + '</div>';
      html += '</td>';
      html += '<td><span class="ls2-pill ' + cls + '">' + d.category + '</span>' +
        ' <span style="font-size:10px;color:var(--color-text-tertiary);">FY' + (d.last_active_fy || '—') + '</span></td>';
      html += '<td style="text-align:center;white-space:nowrap;">' +
        '<span class="ls2-priority-bar"><span class="ls2-priority-fill" style="width:' + Math.min(100, pri) + '%;"></span></span>' +
        '<strong>' + pri + '</strong></td>';
      html += '<td style="text-align:right;font-weight:600;">' + fmtD(d.last_active_fy_giving) + '</td>';
      html += '<td style="text-align:right;color:#16a34a;font-weight:600;" title="' + fmtPct(d.recapture_prob) + ' recapture probability">' + fmtD(d.realistic_recovery) + '</td>';
      html += '<td style="text-align:right;color:var(--color-brand-blue);font-weight:600;">' + fmtD(d.suggested_ask) + '</td>';
      html += '<td style="text-align:right;">' + fmtD(d.lifetime_giving) + '</td>';
      html += '<td style="text-align:center;">' + d.years_lapsed + '</td>';
      html += '<td style="font-size:11px;color:var(--color-text-secondary);white-space:nowrap;">' +
        (d.last_gift_date ? String(d.last_gift_date).split('T')[0] : '') + '</td>';
      const safeId = esc(d.constituent_id);
      const safeName = esc(d.donor_name || '').replace(/'/g, "\\'");
      html += '<td style="white-space:nowrap;">' +
        '<span data-outreach-badge="' + safeId + '" style="display:inline-block;margin-right:4px;"></span>' +
        '<button class="fr-btn fr-btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:2px;" ' +
        'onclick="window._ls2.markContacted(\'' + safeId + '\', \'' + safeName + '\')" ' +
        'title="Mark as contacted"><i class="bi bi-check2"></i></button>' +
        '<button class="fr-btn fr-btn-secondary" style="padding:3px 8px;font-size:11px;" ' +
        'onclick="window._ls2.excludeDonor(\'' + safeId + '\', \'' + safeName + '\')" ' +
        'title="Exclude for 90 days"><i class="bi bi-slash-circle"></i></button>' +
        '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Pagination
    if (totalPages > 1) {
      html += '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;">';
      html += '<button class="fr-btn fr-btn-secondary" style="padding:4px 12px;font-size:12px;"' +
        (page <= 1 ? ' disabled' : ' onclick="window._ls2.setPage(' + (page - 1) + ')"') +
        '><i class="bi bi-chevron-left"></i> Prev</button>';
      const startP = Math.max(1, page - 2);
      const endP = Math.min(totalPages, page + 2);
      if (startP > 1) {
        html += '<button class="fr-btn fr-btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="window._ls2.setPage(1)">1</button>';
        if (startP > 2) html += '<span>…</span>';
      }
      for (let p = startP; p <= endP; p++) {
        if (p === page) html += '<button class="fr-btn" style="padding:4px 10px;font-size:12px;font-weight:700;" disabled>' + p + '</button>';
        else html += '<button class="fr-btn fr-btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="window._ls2.setPage(' + p + ')">' + p + '</button>';
      }
      if (endP < totalPages) {
        if (endP < totalPages - 1) html += '<span>…</span>';
        html += '<button class="fr-btn fr-btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="window._ls2.setPage(' + totalPages + ')">' + totalPages + '</button>';
      }
      html += '<button class="fr-btn fr-btn-secondary" style="padding:4px 12px;font-size:12px;"' +
        (page >= totalPages ? ' disabled' : ' onclick="window._ls2.setPage(' + (page + 1) + ')"') +
        '>Next <i class="bi bi-chevron-right"></i></button>';
      html += '</div>';
    }

    html += '</div></div>';
    return html;
  }

  function bindTableSort() {
    const sel = document.getElementById('ls2-sort');
    if (sel) sel.addEventListener('change', function () { window._ls2.setSort(this.value); });
  }

  // ---------------------------------------------------------------------------
  // Chart.js renderers
  // ---------------------------------------------------------------------------
  function drawTrendChart(trend) {
    const c = document.getElementById('ls2-trend-canvas');
    if (!c || typeof Chart === 'undefined' || !trend || !trend.length) return;
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    const labels = trend.map(t => 'FY' + t.fy);
    trendChart = new Chart(c.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'LYBUNT donors', data: trend.map(t => t.lybuntCount), backgroundColor: '#dc2626', stack: 'donors', yAxisID: 'y', order: 2 },
          { type: 'bar', label: 'SYBUNT donors', data: trend.map(t => t.sybuntCount), backgroundColor: '#d97706', stack: 'donors', yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Foregone revenue', data: trend.map(t => t.lybuntForegone + t.sybuntForegone), borderColor: '#1A223D', backgroundColor: 'rgba(26,34,61,.1)', yAxisID: 'y1', tension: .3, order: 1, borderWidth: 2, pointRadius: 3 },
          { type: 'line', label: 'Realistic recovery', data: trend.map(t => t.lybuntRecovery + t.sybuntRecovery), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.08)', yAxisID: 'y1', tension: .3, order: 1, borderWidth: 2, borderDash: [4, 3], pointRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => {
            const v = ctx.parsed.y;
            return ctx.dataset.label + ': ' + (ctx.dataset.yAxisID === 'y1' ? '$' + v.toLocaleString() : v.toLocaleString());
          } } },
        },
        scales: {
          y: { position: 'left', title: { display: true, text: 'Donors', font: { size: 10 } }, ticks: { font: { size: 10 } }, stacked: true },
          y1: { position: 'right', title: { display: true, text: 'Revenue ($)', font: { size: 10 } }, ticks: { font: { size: 10 }, callback: v => '$' + Number(v).toLocaleString() }, grid: { drawOnChartArea: false } },
          x: { ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  function drawBandsChart(bands, summary) {
    const holder = document.getElementById('ls2-bands');
    if (!holder) return;
    if (!bands || !bands.length) {
      holder.innerHTML = '<div style="text-align:center;color:var(--color-text-secondary);font-size:13px;padding:12px;">No band data.</div>';
      return;
    }
    const ly = bands.filter(b => b.category === 'LYBUNT');
    const sy = bands.filter(b => b.category === 'SYBUNT');
    const maxTotal = Math.max(1, ...bands.map(b => b.band_total));

    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">';
    html += bandColumn('LYBUNT', '#dc2626', ly, maxTotal);
    html += bandColumn('SYBUNT', '#d97706', sy, maxTotal);
    html += '</div>';
    // Reconciliation note
    const bandsSum = bands.reduce((a, b) => a + Number(b.band_total || 0), 0);
    const kpiSum = (summary.lybunt.foregone || 0) + (summary.sybunt.foregone || 0);
    const delta = Math.abs(bandsSum - kpiSum);
    if (delta < 1) {
      html += '<div style="margin-top:10px;font-size:11px;color:#16a34a;"><i class="bi bi-check-circle"></i> Bands reconcile to KPI card total exactly.</div>';
    }
    holder.innerHTML = html;
  }

  function bandColumn(title, color, rows, maxTotal) {
    let h = '<div><div style="font-weight:600;font-size:13px;margin-bottom:10px;color:' + color + ';">' +
      '<i class="bi ' + (title === 'LYBUNT' ? 'bi-exclamation-triangle' : 'bi-clock-history') + '"></i> ' + title + ' by Giving Band</div>';
    if (!rows.length) { h += '<div style="font-size:12px;color:var(--color-text-secondary);">No donors</div></div>'; return h; }
    rows.forEach(r => {
      const pct = (Number(r.band_total) / maxTotal * 100).toFixed(0);
      h += '<div style="margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">' +
        '<span>' + esc(r.band) + '</span>' +
        '<span style="font-weight:600;">' + fmt(r.donor_count) + ' donors · ' + fmtD(r.band_total) +
        ' <span style="color:#16a34a;font-weight:500;">→ ' + fmtD(r.band_recovery) + ' recoverable</span></span></div>' +
        '<div style="background:#f3f4f6;border-radius:4px;overflow:hidden;">' +
        '<div class="ls2-band-bar" style="width:' + pct + '%;background:' + color + ';"></div></div></div>';
    });
    h += '</div>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // Footer (data freshness, methodology disclosure)
  // ---------------------------------------------------------------------------
  function renderFooter(data) {
    const el = document.getElementById('ls2-footer');
    if (!el) return;
    el.style.display = 'block';
    const fresh = data.dataFreshness ? new Date(data.dataFreshness) : new Date();
    const fyLabel = data.fyMonth === 1 ? 'Jan–Dec' :
      monthName(data.fyMonth) + '–' + monthName(((data.fyMonth + 10) % 12) + 1);
    el.innerHTML = '<div style="display:flex;gap:24px;flex-wrap:wrap;">' +
      '<span><i class="bi bi-clock-history"></i> <strong>Data as of</strong> ' + fresh.toLocaleString() + '</span>' +
      '<span><i class="bi bi-calendar3"></i> <strong>Fiscal year</strong> ' + fyLabel + '</span>' +
      '<span><i class="bi bi-slash-circle"></i> Pledges excluded · soft credits not counted</span>' +
      '<span><i class="bi bi-shield-check"></i> Suppressed donors ' + (state.includeSuppressed ? '<strong>included</strong>' : 'hidden by default') + '</span>' +
      '</div>';
  }

  function monthName(m) {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m - 1 + 12) % 12];
  }

  window._ls2_internal = { state, loadData, showModal, esc, fmt, fmtD, fmtPct, fmtPp };
})();
