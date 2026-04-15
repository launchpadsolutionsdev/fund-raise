/* global window, document, fetch */
/**
 * WritingExtras — drop-in client module for the AI-writing features.
 *
 * Provides three pieces of UX that every generator wants but each was
 * implementing on its own:
 *
 *   1. A "Quick Start" template rail (data from /api/writing/templates)
 *   2. A feedback toolbar (👍 / 👎 / ⭐ Save / 🔄 Regenerate)
 *   3. A history drawer (paged, with Recent / Saved tabs)
 *
 * Each view supplies feature-specific bits via callbacks (applyTemplate,
 * restoreItem) and tells the module when generation starts and finishes
 * via the returned controller.
 *
 * The module assumes the host page already has the global fetch wrapper
 * from views/partials/footer.ejs that auto-attaches the CSRF token to
 * non-GET requests.
 */
window.WritingExtras = (function () {
  'use strict';

  // ───────────────────────────────────────────────────────────────────
  // Tiny helpers (escape, format)
  // ───────────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (_) { return String(d).slice(0, 10); }
  }

  // ───────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────
  function init(opts) {
    if (!opts || !opts.feature) {
      throw new Error('WritingExtras.init: feature is required');
    }

    var ctx = {
      feature: opts.feature,
      featureLabel: opts.featureLabel || 'Library',
      accentColor: opts.accentColor || '#7c3aed',
      generateBtn: opts.generateBtn || null,
      outputBody: opts.outputBody || null,
      applyTemplate: opts.applyTemplate || function () {},
      restoreItem: opts.restoreItem || function () {},
      // State
      currentOutputId: null,
      currentRating: null,
      currentSaved: false,
      activeTemplateId: null,
      applyingTemplate: false,
      historyTab: 'recent',
      // Lazy refs to mounted UI
      els: {},
    };

    if (opts.templateRailEl) initTemplates(ctx, opts.templateRailEl);
    if (opts.feedbackMountEl) initFeedback(ctx, opts.feedbackMountEl);
    if (opts.historyMountEl) initHistory(ctx, opts.historyMountEl);

    // Set the accent colour as a CSS variable on the page so the shared
    // stylesheet can theme button highlights without hard-coding colours.
    if (opts.accentColor) {
      document.documentElement.style.setProperty('--we-accent', opts.accentColor);
    }

    var controller = {
      onGenerationStart: function () {
        ctx.currentOutputId = null;
        ctx.currentRating = null;
        ctx.currentSaved = false;
        if (ctx.els.feedbackToolbar) ctx.els.feedbackToolbar.classList.remove('we-show');
        if (ctx.els.savePopover) ctx.els.savePopover.classList.remove('we-show');
      },
      onGenerationDone: function (outputId) {
        if (!outputId) return;
        ctx.currentOutputId = outputId;
        ctx.currentRating = null;
        ctx.currentSaved = false;
        showFeedbackToolbar(ctx);
      },
      // Open / close the history drawer programmatically. Useful for wiring
      // a "History" button outside the drawer mount itself.
      openHistory: function () { if (ctx.openHistory) ctx.openHistory(); },
      closeHistory: function () { if (ctx.closeHistory) ctx.closeHistory(); },
      // Public hook: call when the user "diverges" from a chosen template
      // (e.g. edits a form field manually). Clears the active highlight.
      clearActiveTemplate: function () { clearActiveTemplate(ctx); },
    };
    return controller;
  }

  // ───────────────────────────────────────────────────────────────────
  // Templates
  // ───────────────────────────────────────────────────────────────────
  function initTemplates(ctx, mountEl) {
    ctx.els.templateRail = mountEl;
    mountEl.classList.add('we-template-rail');
    mountEl.innerHTML = '<div class="we-template-loading">Loading templates…</div>';

    fetch('/api/writing/templates?feature=' + encodeURIComponent(ctx.feature))
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (data) {
        var items = (data && data.items) || [];
        if (items.length === 0) {
          // No templates seeded for this feature yet — hide the rail's wrapper if possible.
          var wrap = mountEl.closest('.we-template-wrap') || mountEl;
          wrap.style.display = 'none';
          return;
        }
        ctx.templates = items.reduce(function (m, t) { m[t.id] = t; return m; }, {});
        mountEl.innerHTML = items.map(function (t) {
          var icon = t.icon ? '<i class="bi bi-' + escHtml(t.icon) + '"></i>' : '';
          var title = t.description ? ' title="' + escHtml(t.description) + '"' : '';
          return '<button type="button" class="we-template" data-id="' + escHtml(t.id) + '"' + title + '>'
            + icon + ' ' + escHtml(t.name)
            + '</button>';
        }).join('');
      })
      .catch(function () {
        var wrap = mountEl.closest('.we-template-wrap') || mountEl;
        wrap.style.display = 'none';
      });

    mountEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.we-template');
      if (!btn) return;
      var t = ctx.templates && ctx.templates[btn.dataset.id];
      if (!t) return;
      // Toggle off if same template clicked twice
      if (ctx.activeTemplateId === t.id) {
        btn.classList.remove('is-active');
        ctx.activeTemplateId = null;
        return;
      }
      mountEl.querySelectorAll('.we-template').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      ctx.activeTemplateId = t.id;

      // Hand off to the view-supplied applyTemplate. Wrap with a flag so
      // any "manual edit clears highlight" listener the view registers
      // (which calls clearActiveTemplate) doesn't immediately wipe the
      // highlight we just set.
      ctx.applyingTemplate = true;
      try { ctx.applyTemplate(t.params || {}); }
      finally { ctx.applyingTemplate = false; }
    });
  }

  function clearActiveTemplate(ctx) {
    if (ctx.applyingTemplate || !ctx.activeTemplateId) return;
    ctx.activeTemplateId = null;
    if (ctx.els.templateRail) {
      ctx.els.templateRail.querySelectorAll('.we-template').forEach(function (b) { b.classList.remove('is-active'); });
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Feedback toolbar
  // ───────────────────────────────────────────────────────────────────
  function initFeedback(ctx, mountEl) {
    mountEl.innerHTML = ''
      + '<div class="we-feedback" data-we-feedback>'
      +   '<button class="we-fb-btn we-fb-helpful" data-act="rate" data-val="helpful" title="This worked well"><i class="bi bi-hand-thumbs-up"></i></button>'
      +   '<button class="we-fb-btn we-fb-not-helpful" data-act="rate" data-val="not_helpful" title="Not quite right"><i class="bi bi-hand-thumbs-down"></i></button>'
      +   '<button class="we-fb-btn we-fb-save" data-act="save" title="Save to library"><i class="bi bi-star"></i> Save</button>'
      +   '<button class="we-fb-btn" data-act="regen" title="Generate another version"><i class="bi bi-arrow-repeat"></i> Regenerate</button>'
      + '</div>'
      + '<div class="we-save-popover" data-we-save-popover>'
      +   '<input type="text" data-we-save-name placeholder="Name this draft (optional)" maxlength="120">'
      +   '<div class="we-save-popover-actions">'
      +     '<button class="we-save-popover-btn" data-act="save-cancel">Cancel</button>'
      +     '<button class="we-save-popover-btn primary" data-act="save-confirm">Save to library</button>'
      +   '</div>'
      + '</div>';

    var fbBar = mountEl.querySelector('[data-we-feedback]');
    var savePop = mountEl.querySelector('[data-we-save-popover]');
    var saveNameInput = mountEl.querySelector('[data-we-save-name]');
    var fbHelpful = mountEl.querySelector('.we-fb-helpful');
    var fbNotHelpful = mountEl.querySelector('.we-fb-not-helpful');
    var fbSave = mountEl.querySelector('.we-fb-save');

    ctx.els.feedbackToolbar = fbBar;
    ctx.els.savePopover = savePop;
    ctx.els.fbHelpful = fbHelpful;
    ctx.els.fbNotHelpful = fbNotHelpful;
    ctx.els.fbSave = fbSave;

    fbBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'rate') postRating(ctx, btn.dataset.val);
      else if (btn.dataset.act === 'save') openSavePopover(ctx);
      else if (btn.dataset.act === 'regen' && ctx.generateBtn) ctx.generateBtn.click();
    });

    savePop.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'save-cancel') savePop.classList.remove('we-show');
      else if (btn.dataset.act === 'save-confirm') confirmSave(ctx);
    });

    saveNameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmSave(ctx); }
      else if (e.key === 'Escape') savePop.classList.remove('we-show');
    });

    // Click outside the save popover closes it
    document.addEventListener('click', function (e) {
      if (!e.target.closest('[data-we-save-popover]') && !e.target.closest('.we-fb-save')) {
        savePop.classList.remove('we-show');
      }
    });
  }

  function showFeedbackToolbar(ctx) {
    if (!ctx.els.feedbackToolbar) return;
    ctx.els.feedbackToolbar.classList.add('we-show');
    setRatingButtonState(ctx);
    if (ctx.currentSaved) {
      ctx.els.fbSave.classList.add('is-active');
    } else {
      ctx.els.fbSave.classList.remove('is-active');
      ctx.els.fbSave.innerHTML = '<i class="bi bi-star"></i> Save';
    }
  }

  function setRatingButtonState(ctx) {
    if (!ctx.els.fbHelpful) return;
    ctx.els.fbHelpful.classList.toggle('is-active', ctx.currentRating === 'helpful');
    ctx.els.fbNotHelpful.classList.toggle('is-active', ctx.currentRating === 'not_helpful');
  }

  function postRating(ctx, rating) {
    if (!ctx.currentOutputId) return;
    var next = ctx.currentRating === rating ? null : rating;
    ctx.currentRating = next;
    setRatingButtonState(ctx);
    fetch('/api/writing/library/' + encodeURIComponent(ctx.currentOutputId) + '/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: next }),
    }).catch(function () { /* silent — UI already reflects intent */ });
  }

  function openSavePopover(ctx) {
    if (!ctx.currentOutputId) return;
    if (ctx.currentSaved) {
      // Toggle off — clicking Save again unsaves.
      fetch('/api/writing/library/' + encodeURIComponent(ctx.currentOutputId) + '/unsave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(function () {
        ctx.currentSaved = false;
        ctx.els.fbSave.classList.remove('is-active');
        ctx.els.fbSave.innerHTML = '<i class="bi bi-star"></i> Save';
      });
      return;
    }
    var pop = ctx.els.savePopover;
    var input = pop.querySelector('[data-we-save-name]');
    input.value = '';
    pop.classList.add('we-show');
    setTimeout(function () { input.focus(); }, 0);
  }

  function confirmSave(ctx) {
    if (!ctx.currentOutputId) return;
    var pop = ctx.els.savePopover;
    var input = pop.querySelector('[data-we-save-name]');
    var name = input.value.trim();
    pop.classList.remove('we-show');
    fetch('/api/writing/library/' + encodeURIComponent(ctx.currentOutputId) + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || null }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        ctx.currentSaved = true;
        ctx.els.fbSave.classList.add('is-active');
        var displayName = (data && data.savedName) ? data.savedName : 'Saved';
        ctx.els.fbSave.innerHTML = '<i class="bi bi-star-fill"></i> ' + escHtml(displayName);
        ctx.els.fbSave.title = 'Saved as: ' + displayName + ' — click to unsave';
      });
  }

  // ───────────────────────────────────────────────────────────────────
  // History drawer
  // ───────────────────────────────────────────────────────────────────
  function initHistory(ctx, mountEl) {
    mountEl.innerHTML = ''
      + '<div class="we-history-overlay" data-we-overlay></div>'
      + '<aside class="we-history-drawer" data-we-drawer aria-hidden="true">'
      +   '<div class="we-history-header">'
      +     '<div class="we-history-title"><i class="bi bi-clock-history"></i> ' + escHtml(ctx.featureLabel) + '</div>'
      +     '<button class="we-history-close" data-act="close" aria-label="Close"><i class="bi bi-x-lg"></i></button>'
      +   '</div>'
      +   '<div class="we-history-tabs">'
      +     '<button class="we-history-tab is-active" data-tab="recent">Recent</button>'
      +     '<button class="we-history-tab" data-tab="saved">⭐ Saved</button>'
      +   '</div>'
      +   '<div class="we-history-list" data-we-list>'
      +     '<div class="we-history-empty">Loading…</div>'
      +   '</div>'
      + '</aside>';

    var overlay = mountEl.querySelector('[data-we-overlay]');
    var drawer = mountEl.querySelector('[data-we-drawer]');
    var list = mountEl.querySelector('[data-we-list]');
    var tabs = mountEl.querySelectorAll('.we-history-tab');
    var closeBtn = mountEl.querySelector('[data-act="close"]');

    ctx.els.historyOverlay = overlay;
    ctx.els.historyDrawer = drawer;
    ctx.els.historyList = list;

    function open() {
      overlay.classList.add('we-show');
      drawer.classList.add('we-show');
      drawer.setAttribute('aria-hidden', 'false');
      loadHistory(ctx);
    }
    function close() {
      overlay.classList.remove('we-show');
      drawer.classList.remove('we-show');
      drawer.setAttribute('aria-hidden', 'true');
    }

    overlay.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('we-show')) close();
    });

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        ctx.historyTab = tab.dataset.tab;
        loadHistory(ctx);
      });
    });

    list.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-row-act]');
      var row = e.target.closest('.we-history-row');
      if (!row || !row.dataset.id) return;
      if (actionBtn && actionBtn.dataset.rowAct === 'delete') {
        e.stopPropagation();
        var prompt = window.frConfirm
          ? window.frConfirm('Remove this entry from your history?', { variant: 'danger', title: 'Delete from history' })
          : Promise.resolve(window.confirm('Remove from history?'));
        prompt.then(function (ok) {
          if (!ok) return;
          fetch('/api/writing/library/' + encodeURIComponent(row.dataset.id), { method: 'DELETE' })
            .then(function (r) { if (r.ok) row.remove(); });
        });
        return;
      }
      // Click elsewhere → load this entry
      loadHistoryItem(ctx, row.dataset.id, close);
    });

    // Expose open() so views can wire their own History button
    ctx.openHistory = open;
    ctx.closeHistory = close;
  }

  function loadHistory(ctx) {
    var list = ctx.els.historyList;
    list.innerHTML = '<div class="we-history-empty">Loading…</div>';
    var url = '/api/writing/library?feature=' + encodeURIComponent(ctx.feature) + '&limit=50';
    if (ctx.historyTab === 'saved') url += '&saved=true';
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (data) { renderHistory(ctx, (data && data.items) || []); })
      .catch(function () { list.innerHTML = '<div class="we-history-empty">Could not load history.</div>'; });
  }

  function renderHistory(ctx, items) {
    var list = ctx.els.historyList;
    if (items.length === 0) {
      var msg = ctx.historyTab === 'saved'
        ? 'You haven\'t saved any entries yet. Click ⭐ Save on a generation to add it here.'
        : 'No entries yet. Generate one and it will show up here.';
      list.innerHTML = '<div class="we-history-empty"><i class="bi bi-inbox"></i>' + msg + '</div>';
      return;
    }
    list.innerHTML = items.map(function (item) {
      var p = item.params || {};
      var title = item.isSaved && item.savedName
        ? escHtml(item.savedName)
        : describeParams(ctx, p);
      var when = item.createdAt ? fmtDate(item.createdAt) : '';
      var ratingEmoji = item.rating === 'helpful' ? ' · 👍' : (item.rating === 'not_helpful' ? ' · 👎' : '');
      var savedBadge = item.isSaved ? ' · ⭐' : '';
      return '<div class="we-history-row" data-id="' + escHtml(item.id) + '">'
        + '<div class="we-history-row-actions">'
        +   '<button class="we-history-row-action" data-row-act="delete" title="Delete from history"><i class="bi bi-trash"></i></button>'
        + '</div>'
        + '<div class="we-history-row-meta">' + escHtml(when) + ratingEmoji + savedBadge + '</div>'
        + '<div class="we-history-row-name">' + title + '</div>'
        + '</div>';
    }).join('');
  }

  /**
   * Best-effort description of a saved entry when the user didn't name it.
   * Each feature stores different params, so we just stringify the most
   * informative-looking ones in priority order.
   */
  function describeParams(ctx, p) {
    var bits = [];
    if (p.donorName) bits.push(p.donorName);
    if (p.contentType) bits.push(p.contentType);
    if (p.format) bits.push(p.format);
    if (p.meetingType) bits.push(p.meetingType);
    if (p.tone) bits.push(p.tone);
    if (p.audience) bits.push(p.audience);
    if (p.letterStyle) bits.push(p.letterStyle);
    if (p.giftAmount) bits.push('$' + p.giftAmount);
    if (bits.length === 0) return '<span class="we-history-row-untitled">Untitled</span>';
    return escHtml(bits.join(' · '));
  }

  function loadHistoryItem(ctx, id, closeFn) {
    fetch('/api/writing/library/' + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (item) {
        if (!item) return;
        ctx.currentOutputId = item.id;
        ctx.currentRating = item.rating || null;
        ctx.currentSaved = !!item.isSaved;
        if (ctx.currentSaved && ctx.els.fbSave) {
          ctx.els.fbSave.innerHTML = '<i class="bi bi-star-fill"></i> ' + escHtml(item.savedName || 'Saved');
        }
        // View-specific restore: form fields, output panel, etc.
        try { ctx.restoreItem(item); } catch (_) { /* view's responsibility */ }
        if (ctx.els.feedbackToolbar) showFeedbackToolbar(ctx);
        if (typeof closeFn === 'function') closeFn();
      });
  }

  return { init: init };
})();
