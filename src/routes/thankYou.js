const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { aiRateLimitMiddleware } = require('../services/aiRateLimit');
const {
  streamGeneration,
  thankYouSystemPrompt,
  THANKYOU_STYLES,
} = require('../services/writingService');
const { searchDonors, getDonorProfile } = require('../services/donorContext');

// ── Page ──
router.get('/thank-you-letters', ensureAuth, (req, res) => {
  res.render('thankyou/index', { title: 'Thank-You Letters' });
});

// ── API: Donor autocomplete ──
// Returns aggregated donor rows matching the query. Typeahead should debounce
// and send at least 2 characters.
router.get('/api/thank-you/donors', ensureAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    const limit = req.query.limit;
    const donors = await searchDonors(req.user.tenantId, q, { limit });
    res.json({ donors });
  } catch (err) {
    console.error('[Thank-You donors]', err.message);
    res.status(500).json({ error: 'Failed to search donors.' });
  }
});

// ── API: Donor profile (full detail for UI prefill + context) ──
router.get('/api/thank-you/donors/:constituentId', ensureAuth, async (req, res) => {
  try {
    const profile = await getDonorProfile(req.user.tenantId, req.params.constituentId);
    if (!profile) return res.status(404).json({ error: 'Donor not found.' });
    res.json(profile);
  } catch (err) {
    console.error('[Thank-You donor profile]', err.message);
    res.status(500).json({ error: 'Failed to load donor profile.' });
  }
});

// ── API: Generate letter (SSE) ──
router.post('/api/thank-you/generate', ensureAuth, aiRateLimitMiddleware, async (req, res) => {
  const {
    donorName, giftAmount, giftType, designation, letterStyle, personalNotes,
    constituentId,
  } = req.body;

  if (!letterStyle || !THANKYOU_STYLES[letterStyle]) {
    return res.status(400).json({ error: 'Letter style is required' });
  }

  // Resolve donor context server-side so the client can't forge history.
  // Failure here is non-fatal: fall back to the form-entered donorName.
  let donorContextStr = null;
  let resolvedDonorName = donorName;
  if (constituentId) {
    try {
      const profile = await getDonorProfile(req.user.tenantId, constituentId);
      if (profile) {
        donorContextStr = profile.contextString;
        // Prefer the form-entered name when provided; otherwise use the
        // primary addressee / display name we pulled from the CRM.
        resolvedDonorName = (donorName && donorName.trim()) || profile.uiPrefill.donorName;
      }
    } catch (err) {
      console.error('[Thank-You donor lookup]', err.message);
    }
  }

  await streamGeneration(res, {
    feature: 'thankYou',
    systemPrompt: thankYouSystemPrompt({
      donorName: resolvedDonorName,
      giftAmount, giftType, designation, letterStyle, personalNotes,
      donorContext: donorContextStr,
    }),
    userMessage: 'Generate the thank-you letter based on the parameters above.',
    maxTokens: 1500,
    persist: {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      // Store constituentId so history can link back to the donor; store the
      // resolved name so the saved record matches what the LLM actually saw.
      params: {
        donorName: resolvedDonorName,
        giftAmount, giftType, designation, letterStyle, personalNotes,
        constituentId: constituentId || null,
      },
    },
  });
});

module.exports = router;
