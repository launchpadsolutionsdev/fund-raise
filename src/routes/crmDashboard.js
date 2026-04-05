const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const {
  getCrmOverview, getGivingByMonth, getTopDonors,
  getTopFunds, getTopCampaigns, getTopAppeals, getGiftsByType,
  getFundraiserLeaderboard, getFundraiserPortfolio,
} = require('../services/crmDashboardService');
const { getCrmStats } = require('../services/crmImportService');

// ---------------------------------------------------------------------------
// CRM Dashboard — renders loading page, data fetched via AJAX
// ---------------------------------------------------------------------------
router.get('/crm-dashboard', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const stats = await getCrmStats(tenantId);
    res.render('crm/dashboard', {
      title: 'CRM Dashboard',
      hasData: stats.gifts > 0,
    });
  } catch (err) {
    console.error('[CRM Dashboard]', err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

// AJAX data endpoint
router.get('/crm-dashboard/data', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const [overview, topDonors, topFunds, topCampaigns, topAppeals, giftsByType, givingByMonth] = await Promise.all([
      getCrmOverview(tenantId),
      getTopDonors(tenantId),
      getTopFunds(tenantId),
      getTopCampaigns(tenantId),
      getTopAppeals(tenantId),
      getGiftsByType(tenantId),
      getGivingByMonth(tenantId),
    ]);
    res.json({ overview, topDonors, topFunds, topCampaigns, topAppeals, giftsByType, givingByMonth: givingByMonth.reverse() });
  } catch (err) {
    console.error('[CRM Dashboard Data]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Fundraiser Performance
// ---------------------------------------------------------------------------
router.get('/fundraiser-performance', ensureAuth, async (req, res) => {
  try {
    res.render('crm/fundraiser-performance', {
      title: 'Fundraiser Performance',
      selectedFundraiser: req.query.fundraiser || null,
    });
  } catch (err) {
    console.error('[Fundraiser Performance]', err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

// AJAX data endpoint for fundraiser performance
router.get('/fundraiser-performance/data', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const leaderboard = await getFundraiserLeaderboard(tenantId);
    const selectedFundraiser = req.query.fundraiser || null;
    let portfolio = null;
    if (selectedFundraiser) {
      portfolio = await getFundraiserPortfolio(tenantId, selectedFundraiser);
    }
    res.json({ leaderboard, selectedFundraiser, portfolio });
  } catch (err) {
    console.error('[Fundraiser Performance Data]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
