const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const {
  getCrmOverview, getGivingByMonth, getTopDonors,
  getTopFunds, getTopCampaigns, getTopAppeals, getGiftsByType,
  getFundraiserLeaderboard, getFundraiserPortfolio,
} = require('../services/crmDashboardService');
const { getCrmStats } = require('../services/crmImportService');

// ---------------------------------------------------------------------------
// CRM Dashboard
// ---------------------------------------------------------------------------
router.get('/crm-dashboard', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const stats = await getCrmStats(tenantId);

    if (stats.gifts === 0) {
      return res.render('crm/dashboard', {
        title: 'CRM Dashboard',
        hasData: false, overview: null, topDonors: [], topFunds: [],
        topCampaigns: [], topAppeals: [], giftsByType: [], givingByMonth: [],
      });
    }

    const [overview, topDonors, topFunds, topCampaigns, topAppeals, giftsByType, givingByMonth] = await Promise.all([
      getCrmOverview(tenantId),
      getTopDonors(tenantId),
      getTopFunds(tenantId),
      getTopCampaigns(tenantId),
      getTopAppeals(tenantId),
      getGiftsByType(tenantId),
      getGivingByMonth(tenantId),
    ]);

    res.render('crm/dashboard', {
      title: 'CRM Dashboard',
      hasData: true,
      overview, topDonors, topFunds, topCampaigns, topAppeals, giftsByType,
      givingByMonth: givingByMonth.reverse(),
    });
  } catch (err) {
    console.error('[CRM Dashboard]', err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Fundraiser Performance
// ---------------------------------------------------------------------------
router.get('/fundraiser-performance', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const leaderboard = await getFundraiserLeaderboard(tenantId);

    const selectedFundraiser = req.query.fundraiser || null;
    let portfolio = null;
    if (selectedFundraiser) {
      portfolio = await getFundraiserPortfolio(tenantId, selectedFundraiser);
    }

    res.render('crm/fundraiser-performance', {
      title: 'Fundraiser Performance',
      leaderboard,
      selectedFundraiser,
      portfolio,
    });
  } catch (err) {
    console.error('[Fundraiser Performance]', err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

module.exports = router;
