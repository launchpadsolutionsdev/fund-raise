const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const {
  getCrmOverview, getGivingByMonth, getTopDonors,
  getTopFunds, getTopCampaigns, getTopAppeals, getGiftsByType,
  getFundraiserLeaderboard, getFundraiserPortfolio, getFiscalYears,
} = require('../services/crmDashboardService');
const { getCrmStats } = require('../services/crmImportService');

// Convert FY number to date range: FY2025 = April 1 2024 – March 31 2025
function fyToDateRange(fy) {
  if (!fy) return null;
  const year = Number(fy);
  if (isNaN(year)) return null;
  return {
    startDate: `${year - 1}-04-01`,
    endDate: `${year}-04-01`, // exclusive upper bound
  };
}

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
    const dateRange = fyToDateRange(req.query.fy);
    const [overview, topDonors, topFunds, topCampaigns, topAppeals, giftsByType, givingByMonth, fiscalYears] = await Promise.all([
      getCrmOverview(tenantId, dateRange),
      getTopDonors(tenantId, dateRange),
      getTopFunds(tenantId, dateRange),
      getTopCampaigns(tenantId, dateRange),
      getTopAppeals(tenantId, dateRange),
      getGiftsByType(tenantId, dateRange),
      getGivingByMonth(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({
      overview, topDonors, topFunds, topCampaigns, topAppeals, giftsByType,
      givingByMonth: givingByMonth.reverse(),
      fiscalYears,
      selectedFY: req.query.fy ? Number(req.query.fy) : null,
    });
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
    const dateRange = fyToDateRange(req.query.fy);
    const [leaderboard, fiscalYears] = await Promise.all([
      getFundraiserLeaderboard(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    const selectedFundraiser = req.query.fundraiser || null;
    let portfolio = null;
    if (selectedFundraiser) {
      portfolio = await getFundraiserPortfolio(tenantId, selectedFundraiser, dateRange);
    }
    res.json({
      leaderboard, selectedFundraiser, portfolio,
      fiscalYears,
      selectedFY: req.query.fy ? Number(req.query.fy) : null,
    });
  } catch (err) {
    console.error('[Fundraiser Performance Data]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
