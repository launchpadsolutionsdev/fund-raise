const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const {
  getCrmOverview, getGivingByMonth, getTopDonors,
  getTopFunds, getTopCampaigns, getTopAppeals, getGiftsByType,
  getFundraiserLeaderboard, getFundraiserPortfolio, getFiscalYears,
  getDonorRetention, getGivingPyramid,
  getDonorDetail, searchGifts, getFilterOptions, getEntityDetail,
  getDonorScoring, getFundraiserGoals, setFundraiserGoal, deleteFundraiserGoal,
  getRecurringDonorAnalysis,
  getAcknowledgmentTracker, getMatchingGiftAnalysis, getSoftCreditAnalysis,
  getPaymentMethodAnalysis, getDonorLifecycleAnalysis,
  getGiftTrendAnalysis, getCampaignComparison, getFundHealthReport,
  getYearOverYearComparison, getDonorInsights,
  getAppealComparison, getAppealDetail,
  getDepartmentAnalytics, getDepartmentExtras,
  getDepartmentGoals, setDepartmentGoal, deleteDepartmentGoal, getDepartmentActuals,
  getDataQualityReport,
  getLybuntSybunt,
  getDonorUpgradeDowngrade,
  getFirstTimeDonorConversion,
  getProactiveInsights,
  getRetentionDrilldown,
  getHouseholdGiving,
  getAnomalyDetection,
  getAIRecommendations,
} = require('../services/crmDashboardService');
const { getCrmStats } = require('../services/crmImportService');
const { Tenant } = require('../models');

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

// Server-side timeout guard — respond before Render's 30s connection timeout
function withTimeout(handler, label, ms = 25000) {
  return async (req, res) => {
    const t0 = Date.now();
    console.log(`[${label}] Request received: ${req.originalUrl}`);
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        console.error(`[${label}] ${ms/1000}s timeout — aborting (${Date.now() - t0}ms elapsed)`);
        res.status(504).json({ error: 'Query took too long. Try selecting a specific Fiscal Year to narrow the data.' });
      }
    }, ms);
    try {
      await handler(req, res);
      console.log(`[${label}] Done in ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`[${label}] Error after ${Date.now() - t0}ms:`, err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    } finally {
      clearTimeout(timer);
    }
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

// AJAX data endpoint — queries run in small batches to avoid overloading the DB
router.get('/crm-dashboard/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const dateRange = fyToDateRange(req.query.fy);
  const priorDateRange = req.query.fy ? fyToDateRange(Number(req.query.fy) - 1) : null;
  const fy = req.query.fy ? Number(req.query.fy) : null;

  // Batch 1: core stats
  const [overview, fiscalYears, givingByMonth] = await Promise.all([
    getCrmOverview(tenantId, dateRange),
    getFiscalYears(tenantId),
    getGivingByMonth(tenantId, dateRange),
  ]);

  // Batch 2: top lists
  const [topDonors, topFunds, topCampaigns, topAppeals] = await Promise.all([
    getTopDonors(tenantId, dateRange),
    getTopFunds(tenantId, dateRange),
    getTopCampaigns(tenantId, dateRange),
    getTopAppeals(tenantId, dateRange),
  ]);

  // Batch 3: supplementary
  const batch3 = [getGiftsByType(tenantId, dateRange), getGivingPyramid(tenantId, dateRange)];
  if (priorDateRange) {
    batch3.push(getCrmOverview(tenantId, priorDateRange));
    batch3.push(getDonorRetention(tenantId, fy));
  }
  const batch3Results = await Promise.all(batch3);
  const giftsByType = batch3Results[0];
  const pyramid = batch3Results[1];
  const priorOverview = priorDateRange ? batch3Results[2] : null;
  const retention = priorDateRange ? batch3Results[3] : null;

  res.json({
    overview, topDonors, topFunds, topCampaigns, topAppeals, giftsByType,
    givingByMonth: givingByMonth.reverse(),
    fiscalYears, pyramid, retention,
    selectedFY: fy,
    priorOverview,
  });
}, 'CRM Dashboard'));

// Proactive insights — lazy-loaded after main dashboard renders
router.get('/crm-dashboard/insights', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const insights = await getProactiveInsights(tenantId, fy);
  res.json({ insights });
}, 'Proactive Insights'));

// ---------------------------------------------------------------------------
// Fundraiser Performance
// ---------------------------------------------------------------------------
router.get('/fundraiser-performance', ensureAuth, (req, res) => {
  console.log('[Fundraiser Perf] Rendering page...');
  res.render('crm/fundraiser-performance', {
    title: 'Fundraiser Performance',
    selectedFundraiser: req.query.fundraiser || null,
  }, (err, html) => {
    if (err) {
      console.error('[Fundraiser Perf] RENDER ERROR:', err.message);
      return res.status(500).render('error', { title: 'Error', message: err.message });
    }
    console.log('[Fundraiser Perf] Rendered OK, size:', html.length);
    res.send(html);
  });
});

// AJAX data endpoint for fundraiser performance
router.get('/fundraiser-performance/data', ensureAuth, async (req, res) => {
  // Guard: respond within 25s to avoid Render's request timeout killing the connection
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.error('[Fundraiser Perf] 25s timeout — aborting');
      res.status(504).json({ error: 'Query took too long. Try selecting a specific Fiscal Year instead of All Time.' });
    }
  }, 25000);
  try {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    console.log('[Fundraiser Perf] Loading data, fy:', req.query.fy || 'all');
    const [leaderboard, fiscalYears] = await Promise.all([
      getFundraiserLeaderboard(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    console.log('[Fundraiser Perf] Done. rows:', leaderboard.length);
    const selectedFundraiser = req.query.fundraiser || null;
    let portfolio = null;
    if (selectedFundraiser) {
      portfolio = await getFundraiserPortfolio(tenantId, selectedFundraiser, dateRange);
    }
    clearTimeout(timer);
    if (!res.headersSent) {
      res.json({
        leaderboard, selectedFundraiser, portfolio,
        fiscalYears,
        selectedFY: req.query.fy ? Number(req.query.fy) : null,
      });
    }
  } catch (err) {
    clearTimeout(timer);
    console.error('[Fundraiser Performance Data]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Donor Detail
// ---------------------------------------------------------------------------
router.get('/crm/donor/:constituentId', ensureAuth, async (req, res) => {
  try {
    res.render('crm/donor-detail', {
      title: 'Donor Detail',
      constituentId: req.params.constituentId,
    });
  } catch (err) {
    console.error('[Donor Detail]', err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/donor/:constituentId/data', ensureAuth, withTimeout(async (req, res) => {
  const data = await getDonorDetail(req.user.tenantId, req.params.constituentId);
  res.json(data);
}, 'Donor Detail'));

// ---------------------------------------------------------------------------
// Gift Search / Browse
// ---------------------------------------------------------------------------
router.get('/crm/gifts', ensureAuth, async (req, res) => {
  try {
    res.render('crm/gift-search', { title: 'Gift Search' });
  } catch (err) {
    console.error('[Gift Search]', err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/gifts/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const dateRange = fyToDateRange(req.query.fy);
  const opts = {
    page: Number(req.query.page) || 1,
    limit: Math.min(Number(req.query.limit) || 50, 200),
    search: req.query.search || null,
    fund: req.query.fund || null,
    campaign: req.query.campaign || null,
    appeal: req.query.appeal || null,
    minAmount: req.query.minAmount || null,
    maxAmount: req.query.maxAmount || null,
    dateRange,
    sortBy: req.query.sortBy || 'gift_date',
    sortDir: req.query.sortDir || 'DESC',
  };
  const [results, filters, fiscalYears] = await Promise.all([
    searchGifts(tenantId, opts),
    getFilterOptions(tenantId),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...results, filters, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Gift Search'));

// ---------------------------------------------------------------------------
// Donor Scoring & Segmentation
// (Must be above the /crm/:entityType/:entityId wildcard route)
// ---------------------------------------------------------------------------
router.get('/crm/donor-scoring', ensureAuth, async (req, res) => {
  try {
    res.render('crm/donor-scoring', { title: 'Donor Scoring' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/donor-scoring/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getDonorScoring(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Donor Scoring'));

// ---------------------------------------------------------------------------
// Recurring Donor Analysis
// (Must be above the /crm/:entityType/:entityId wildcard route)
// ---------------------------------------------------------------------------
router.get('/crm/recurring-donors', ensureAuth, async (req, res) => {
  try {
    res.render('crm/recurring-donors', { title: 'Recurring Donors' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/recurring-donors/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getRecurringDonorAnalysis(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Recurring Donors'));

// ---------------------------------------------------------------------------
// Acknowledgment Tracker
// ---------------------------------------------------------------------------
router.get('/crm/acknowledgments', ensureAuth, async (req, res) => {
  try {
    res.render('crm/acknowledgments', { title: 'Acknowledgment Tracker' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/acknowledgments/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getAcknowledgmentTracker(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Acknowledgments'));

// ---------------------------------------------------------------------------
// Matching Gift Analysis
// ---------------------------------------------------------------------------
router.get('/crm/matching-gifts', ensureAuth, async (req, res) => {
  try {
    res.render('crm/matching-gifts', { title: 'Matching Gift Analysis' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/matching-gifts/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getMatchingGiftAnalysis(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Matching Gifts'));

// ---------------------------------------------------------------------------
// Soft Credit Analytics
// ---------------------------------------------------------------------------
router.get('/crm/soft-credits', ensureAuth, async (req, res) => {
  try {
    res.render('crm/soft-credits', { title: 'Soft Credit Analytics' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/soft-credits/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getSoftCreditAnalysis(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Soft Credits'));

// ---------------------------------------------------------------------------
// Payment Method Analysis
// ---------------------------------------------------------------------------
router.get('/crm/payment-methods', ensureAuth, async (req, res) => {
  try {
    res.render('crm/payment-methods', { title: 'Payment Methods' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/payment-methods/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getPaymentMethodAnalysis(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Payment Methods'));

// ---------------------------------------------------------------------------
// Donor Lifecycle Analysis
// ---------------------------------------------------------------------------
router.get('/crm/donor-lifecycle', ensureAuth, async (req, res) => {
  try {
    res.render('crm/donor-lifecycle', { title: 'Donor Lifecycle' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/donor-lifecycle/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getDonorLifecycleAnalysis(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Donor Lifecycle'));

// ---------------------------------------------------------------------------
// Gift Size Trend Analysis
// ---------------------------------------------------------------------------
router.get('/crm/gift-trends', ensureAuth, async (req, res) => {
  try {
    res.render('crm/gift-trends', { title: 'Gift Trend Analysis' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/gift-trends/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getGiftTrendAnalysis(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Gift Trends'));

// ---------------------------------------------------------------------------
// Campaign Performance Comparison
// ---------------------------------------------------------------------------
router.get('/crm/campaign-compare', ensureAuth, async (req, res) => {
  try {
    res.render('crm/campaign-compare', { title: 'Campaign Comparison' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/campaign-compare/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getCampaignComparison(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Campaign Compare'));

// ---------------------------------------------------------------------------
// Fund Health / Diversification Report
// ---------------------------------------------------------------------------
router.get('/crm/fund-health', ensureAuth, async (req, res) => {
  try {
    res.render('crm/fund-health', { title: 'Fund Health Report' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/fund-health/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getFundHealthReport(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Fund Health'));

// ---------------------------------------------------------------------------
// Year-over-Year Comparison Dashboard
// ---------------------------------------------------------------------------
router.get('/crm/yoy-compare', ensureAuth, async (req, res) => {
  try {
    res.render('crm/yoy-compare', { title: 'Year-over-Year Comparison' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/yoy-compare/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const [data, fiscalYears] = await Promise.all([
      getYearOverYearComparison(tenantId),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears });
}, 'YoY Compare'));

// ---------------------------------------------------------------------------
// Donor Communication Insights
// ---------------------------------------------------------------------------
router.get('/crm/donor-insights', ensureAuth, async (req, res) => {
  try {
    res.render('crm/donor-insights', { title: 'Donor Insights' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/donor-insights/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getDonorInsights(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Donor Insights'));

// ---------------------------------------------------------------------------
// Appeal Comparison
// ---------------------------------------------------------------------------
router.get('/crm/appeal-compare', ensureAuth, async (req, res) => {
  try {
    res.render('crm/appeal-compare', { title: 'Appeal Comparison' });
  } catch (err) { res.status(500).render('error', { title: 'Error', message: err.message }); }
});

router.get('/crm/appeal-compare/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const [result, fiscalYears] = await Promise.all([
      getAppealComparison(tenantId, dateRange),
      getFiscalYears(tenantId),
    ]);
    res.json({ ...result, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Appeal Compare'));

router.get('/crm/appeal-compare/detail', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const dateRange = fyToDateRange(req.query.fy);
    const appealId = req.query.id;
    if (!appealId) return res.status(400).json({ error: 'Appeal ID required' });
    const detail = await getAppealDetail(tenantId, appealId, dateRange);
    res.json(detail);
}, 'Appeal Detail'));

// ---------------------------------------------------------------------------
// Department Analytics (heuristic classification)
// ---------------------------------------------------------------------------
router.get('/crm/department-analytics', ensureAuth, (req, res) => {
  res.render('crm/department-analytics', { title: 'Department Analytics' });
});

router.get('/crm/department-analytics/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const dateRange = fyToDateRange(req.query.fy);
  const [result, fiscalYears] = await Promise.all([
    getDepartmentAnalytics(tenantId, dateRange),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...result, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Dept Analytics', 29000));

router.get('/crm/department-analytics/extras', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const dateRange = fyToDateRange(req.query.fy);
  const result = await getDepartmentExtras(tenantId, dateRange);
  res.json(result);
}, 'Dept Extras', 29000));

// ---------------------------------------------------------------------------
// Department Goals
// ---------------------------------------------------------------------------
router.get('/crm/department-goals', ensureAuth, (req, res) => {
  res.render('crm/department-goals', { title: 'Department Goals' });
});

router.get('/crm/department-goals/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const dateRange = fyToDateRange(fy);
  const [actuals, goals, fiscalYears] = await Promise.all([
    getDepartmentActuals(tenantId, dateRange),
    getDepartmentGoals(tenantId, fy),
    getFiscalYears(tenantId),
  ]);

  // Merge goals into actuals
  const goalMap = {};
  goals.forEach(g => { goalMap[g.department] = Number(g.goalAmount); });
  const DEPTS = ['Annual Giving', 'Direct Mail', 'Events', 'Major Gifts', 'Legacy Giving'];
  const merged = DEPTS.map(dept => {
    const a = actuals.find(r => r.department === dept) || { total: 0, gift_count: 0, donor_count: 0 };
    const goal = goalMap[dept] || null;
    return {
      department: dept,
      total: Number(a.total),
      gift_count: Number(a.gift_count),
      donor_count: Number(a.donor_count),
      goal,
      pct: goal ? Math.round(Number(a.total) / goal * 100) : null,
    };
  });

  res.json({ departments: merged, fiscalYears, selectedFY: fy });
}, 'Dept Goals'));

router.post('/crm/department-goals', ensureAuth, async (req, res) => {
  try {
    const { department, fiscalYear, goalAmount } = req.body;
    if (!department || !fiscalYear || !goalAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    await setDepartmentGoal(req.user.tenantId, department, Number(fiscalYear), Number(goalAmount));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Set Dept Goal]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/crm/department-goals', ensureAuth, async (req, res) => {
  try {
    const { department, fiscalYear } = req.body;
    await deleteDepartmentGoal(req.user.tenantId, department, Number(fiscalYear));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Delete Dept Goal]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Data Quality Dashboard
// ---------------------------------------------------------------------------
router.get('/crm/data-quality', ensureAuth, (req, res) => {
  res.render('crm/data-quality', { title: 'Data Quality' });
});

router.get('/crm/data-quality/data', ensureAuth, withTimeout(async (req, res) => {
  const report = await getDataQualityReport(req.user.tenantId);
  res.json(report);
}, 'Data Quality'));

// ---------------------------------------------------------------------------
// Enhanced Retention Analytics (drill-down)
// ---------------------------------------------------------------------------
router.get('/crm/retention', ensureAuth, (req, res) => {
  res.render('crm/retention', { title: 'Retention Analytics' });
});

router.get('/crm/retention/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const [data, fiscalYears] = await Promise.all([
    getRetentionDrilldown(tenantId, fy),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...data, fiscalYears, selectedFY: fy });
}, 'Retention Drilldown'));

// ---------------------------------------------------------------------------
// Household-Level Giving
// ---------------------------------------------------------------------------
router.get('/crm/household-giving', ensureAuth, (req, res) => {
  res.render('crm/household-giving', { title: 'Household Giving' });
});

router.get('/crm/household-giving/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const dateRange = fyToDateRange(req.query.fy);
  const [data, fiscalYears] = await Promise.all([
    getHouseholdGiving(tenantId, dateRange),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Household Giving'));

// ---------------------------------------------------------------------------
// LYBUNT / SYBUNT Dashboard
// ---------------------------------------------------------------------------
router.get('/crm/lybunt-sybunt', ensureAuth, (req, res) => {
  res.render('crm/lybunt-sybunt', { title: 'LYBUNT / SYBUNT' });
});

router.get('/crm/lybunt-sybunt/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fiscalYears = await getFiscalYears(tenantId);
  const fy = req.query.fy ? Number(req.query.fy) : (fiscalYears && fiscalYears.length ? fiscalYears[0].fy : null);
  const data = await getLybuntSybunt(tenantId, fy);
  res.json({ ...(data || {}), fiscalYears, selectedFY: fy });
}, 'LYBUNT/SYBUNT'));

// ---------------------------------------------------------------------------
// Donor Upgrade / Downgrade Tracking
// ---------------------------------------------------------------------------
router.get('/crm/donor-upgrade-downgrade', ensureAuth, (req, res) => {
  res.render('crm/donor-upgrade-downgrade', { title: 'Donor Upgrade / Downgrade' });
});

router.get('/crm/donor-upgrade-downgrade/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const [data, fiscalYears] = await Promise.all([
    getDonorUpgradeDowngrade(tenantId, fy),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...data, fiscalYears, selectedFY: fy });
}, 'Donor Upgrade/Downgrade'));

// ---------------------------------------------------------------------------
// First-Time Donor Conversion Funnel
// ---------------------------------------------------------------------------
router.get('/crm/first-time-donors', ensureAuth, (req, res) => {
  res.render('crm/first-time-donors', { title: 'First-Time Donor Conversion' });
});

router.get('/crm/first-time-donors/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const dateRange = fyToDateRange(req.query.fy);
  const [data, fiscalYears] = await Promise.all([
    getFirstTimeDonorConversion(tenantId, dateRange),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'First-Time Donors'));

// ---------------------------------------------------------------------------
// Board-Ready PDF Report — uses PDFKit for server-side generation
// ---------------------------------------------------------------------------
router.get('/crm/board-report', ensureAuth, (req, res) => {
  res.render('crm/board-report', { title: 'Board Report' });
});

router.get('/crm/board-report/pdf', ensureAuth, withTimeout(async (req, res) => {
  const PDFDocument = require('pdfkit');
  const path = require('path');
  const fs = require('fs');
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const dateRange = fy ? fyToDateRange(fy) : null;
  const priorDateRange = fy ? fyToDateRange(fy - 1) : null;

  // Fetch all data in parallel
  const batch = [
    getCrmOverview(tenantId, dateRange),
    getTopDonors(tenantId, dateRange, 5),
    getTopFunds(tenantId, dateRange, 5),
    getTopCampaigns(tenantId, dateRange, 5),
    getGivingPyramid(tenantId, dateRange),
    Tenant.findByPk(tenantId),
  ];
  if (priorDateRange) {
    batch.push(getCrmOverview(tenantId, priorDateRange));
    batch.push(getDonorRetention(tenantId, fy));
  }
  const results = await Promise.all(batch);
  const overview = results[0];
  const topDonors = results[1].slice(0, 5);
  const topFunds = results[2].slice(0, 5);
  const topCampaigns = results[3].slice(0, 5);
  const pyramid = results[4] || [];
  const tenant = results[5];
  const priorOverview = priorDateRange ? results[6] : null;
  const retention = priorDateRange ? results[7] : null;

  // Helpers
  const fmtN = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtD = n => '$' + fmtN(n);
  const fmtCompact = n => {
    const v = Number(n || 0);
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'K';
    return '$' + fmtN(v);
  };
  const yoyPct = (cur, prev) => {
    const c = Number(cur), p = Number(prev);
    if (!p) return null;
    return ((c - p) / p * 100).toFixed(1);
  };
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fyLabel = fy ? 'FY' + fy + ' (Apr ' + (fy - 1) + ' – Mar ' + fy + ')' : 'All Time';
  const orgName = (tenant && tenant.name) ? tenant.name : 'Fund-Raise';

  // Colors
  const navy = '#003B5C';
  const blue = '#0072BB';
  const gold = '#D4A843';
  const gray = '#6b7280';
  const lightGray = '#f3f4f6';
  const green = '#16a34a';
  const red = '#dc2626';
  const white = '#FFFFFF';

  // Create PDF — landscape letter
  const doc = new PDFDocument({
    size: 'letter',
    layout: 'landscape',
    margins: { top: 30, bottom: 25, left: 35, right: 35 },
  });
  const filename = 'Board_Report' + (fy ? '_FY' + fy : '') + '_' + new Date().toISOString().split('T')[0] + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);

  const pageW = 792; // letter landscape
  const pageH = 612;
  const mL = 35;
  const mR = 35;
  const contentW = pageW - mL - mR;

  // ── HEADER BAR ──
  doc.rect(0, 0, pageW, 52).fill(navy);
  doc.fontSize(18).fillColor(white).text(orgName, mL + 5, 14, { width: 300 });
  doc.fontSize(10).fillColor(gold).text('Board Report', mL + 5, 35, { width: 200 });
  doc.fontSize(10).fillColor(white).text(fyLabel, pageW / 2 - 80, 18, { width: 200, align: 'center' });
  doc.fontSize(8).fillColor('#94a3b8').text(today, pageW - mR - 160, 20, { width: 155, align: 'right' });

  // ── 4 HERO KPI CARDS ──
  const o = overview;
  const cardY = 62;
  const cardH = 58;
  const cardGap = 10;
  const cardW = (contentW - cardGap * 3) / 4;

  const heroKpis = [
    { label: 'Total Raised', value: fmtCompact(o.total_raised), raw: o.total_raised, priorRaw: priorOverview ? priorOverview.total_raised : null },
    { label: 'Total Gifts', value: fmtN(o.total_gifts), raw: o.total_gifts, priorRaw: priorOverview ? priorOverview.total_gifts : null },
    { label: 'Unique Donors', value: fmtN(o.unique_donors), raw: o.unique_donors, priorRaw: priorOverview ? priorOverview.unique_donors : null },
    { label: 'Retention Rate', value: retention ? retention.retention_rate + '%' : 'N/A', raw: null, priorRaw: null },
  ];

  heroKpis.forEach((kpi, i) => {
    const x = mL + i * (cardW + cardGap);
    // Card background
    doc.roundedRect(x, cardY, cardW, cardH, 4).fill(lightGray);
    // Value
    doc.fontSize(20).fillColor(navy).text(kpi.value, x + 8, cardY + 8, { width: cardW - 16 });
    // Label
    doc.fontSize(8).fillColor(gray).text(kpi.label, x + 8, cardY + 32, { width: cardW - 16 });
    // YoY delta
    if (kpi.priorRaw !== null) {
      const pct = yoyPct(kpi.raw, kpi.priorRaw);
      if (pct !== null) {
        const isUp = Number(pct) >= 0;
        const arrow = isUp ? '\u25B2' : '\u25BC';
        doc.fontSize(8).fillColor(isUp ? green : red)
          .text(arrow + ' ' + (isUp ? '+' : '') + pct + '% YoY', x + 8, cardY + 44, { width: cardW - 16 });
      }
    }
    // Retention sub-line
    if (i === 3 && retention) {
      const rateNum = Number(retention.retention_rate);
      doc.fontSize(8).fillColor(rateNum >= 50 ? green : red)
        .text(fmtN(retention.retained) + ' retained / ' + fmtN(retention.lapsed) + ' lapsed', x + 8, cardY + 44, { width: cardW - 16 });
    }
  });

  // ── MIDDLE SECTION: 3 columns ──
  const midY = cardY + cardH + 14;
  const col3Gap = 12;
  const col3W = (contentW - col3Gap * 2) / 3;

  // Helper: draw a mini-table
  function drawMiniTable(title, items, x, y, w, nameKey, valKey) {
    doc.fontSize(10).fillColor(navy).text(title, x, y, { width: w });
    const tY = y + 16;
    // Header underline
    doc.moveTo(x, tY).lineTo(x + w, tY).strokeColor('#d1d5db').lineWidth(0.5).stroke();
    let rowY = tY + 4;
    items.forEach((item, i) => {
      const name = typeof nameKey === 'function' ? nameKey(item) : (item[nameKey] || 'Unknown');
      const val = typeof valKey === 'function' ? valKey(item) : item[valKey];
      // Alternate row background
      if (i % 2 === 0) {
        doc.rect(x, rowY - 1, w, 13).fill('#f9fafb');
      }
      doc.fontSize(8).fillColor(navy)
        .text((i + 1) + '.', x + 2, rowY, { width: 14 })
        .text(name.length > 28 ? name.substring(0, 27) + '…' : name, x + 16, rowY, { width: w - 80 })
        .text(val, x + w - 62, rowY, { width: 60, align: 'right' });
      rowY += 14;
    });
    return rowY;
  }

  // Column 1: Top 5 Donors
  drawMiniTable('Top 5 Donors', topDonors, mL, midY, col3W,
    d => (d.first_name || '') + ' ' + (d.last_name || '') || d.constituent_name || 'Anonymous',
    d => fmtD(d.total_credited || d.total_given || d.total || 0));

  // Column 2: Top 5 Funds
  drawMiniTable('Top 5 Funds', topFunds, mL + col3W + col3Gap, midY, col3W,
    'fund_description',
    f => fmtD(f.total));

  // Column 3: Giving Pyramid (visual bars)
  const pyrX = mL + (col3W + col3Gap) * 2;
  doc.fontSize(10).fillColor(navy).text('Giving Pyramid', pyrX, midY, { width: col3W });
  const pyrStartY = midY + 16;
  doc.moveTo(pyrX, pyrStartY).lineTo(pyrX + col3W, pyrStartY).strokeColor('#d1d5db').lineWidth(0.5).stroke();

  if (pyramid.length) {
    const maxTotal = Math.max(...pyramid.map(p => Number(p.total || p.band_total || 0)), 1);
    const maxBarW = col3W - 110;
    let pyrY = pyrStartY + 4;
    pyramid.forEach(p => {
      const total = Number(p.total || p.band_total || 0);
      const donors = Number(p.donors || p.donor_count || 0);
      const barW = Math.max(4, (total / maxTotal) * maxBarW);
      const band = (p.band || '').length > 12 ? (p.band || '').substring(0, 11) + '…' : (p.band || '');
      doc.fontSize(7).fillColor(gray).text(band, pyrX + 2, pyrY + 1, { width: 68 });
      // Bar
      doc.rect(pyrX + 72, pyrY, barW, 10).fill(blue);
      // Value label
      doc.fontSize(7).fillColor(navy).text(fmtCompact(total), pyrX + 72 + barW + 4, pyrY + 1, { width: 50 });
      pyrY += 14;
    });
  } else {
    doc.fontSize(8).fillColor(gray).text('No giving data available', pyrX + 4, pyrStartY + 8);
  }

  // ── BOTTOM SECTION ──
  const botY = midY + 148;
  doc.moveTo(mL, botY).lineTo(mL + contentW, botY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  const botContentY = botY + 8;

  // Bottom left: Top 5 Campaigns (compact horizontal)
  doc.fontSize(10).fillColor(navy).text('Top 5 Campaigns', mL, botContentY, { width: contentW / 2 });
  let campY = botContentY + 15;
  topCampaigns.forEach((c, i) => {
    const name = (c.campaign_description || 'Unknown');
    const display = name.length > 35 ? name.substring(0, 34) + '…' : name;
    doc.fontSize(8).fillColor(navy)
      .text((i + 1) + '. ' + display, mL + 4, campY, { continued: true, width: 280 })
      .fillColor(gray).text('  ' + fmtD(c.total) + ' (' + fmtN(c.gift_count) + ' gifts)', { continued: false });
    campY += 12;
  });

  // Bottom right: Key Metrics + Retention bar
  const rightX = mL + contentW / 2 + 20;
  doc.fontSize(10).fillColor(navy).text('Key Metrics', rightX, botContentY, { width: contentW / 2 - 20 });
  let metY = botContentY + 15;

  const metrics = [
    ['Average Gift', fmtD(o.avg_gift)],
    ['Largest Gift', fmtD(o.largest_gift)],
    ['Date Range', o.earliest_date ? o.earliest_date.substring(0, 10) + ' → ' + (o.latest_date || '').substring(0, 10) : 'N/A'],
  ];
  metrics.forEach(([lbl, val]) => {
    doc.fontSize(8).fillColor(gray).text(lbl + ':', rightX + 4, metY, { width: 80, continued: true });
    doc.fillColor(navy).text('  ' + val, { continued: false });
    metY += 12;
  });

  // Retention visual bar
  if (retention) {
    metY += 4;
    doc.fontSize(8).fillColor(gray).text('Donor Retention', rightX + 4, metY);
    metY += 12;
    const barTotalW = contentW / 2 - 40;
    const totalDonors = Number(retention.retained) + Number(retention.lapsed) + Number(retention.brand_new) + Number(retention.recovered);
    if (totalDonors > 0) {
      const retW = (Number(retention.retained) / totalDonors) * barTotalW;
      const newW = (Number(retention.brand_new) / totalDonors) * barTotalW;
      const recW = (Number(retention.recovered) / totalDonors) * barTotalW;
      const lapW = (Number(retention.lapsed) / totalDonors) * barTotalW;
      let bx = rightX + 4;
      doc.rect(bx, metY, retW, 10).fill(green); bx += retW;
      doc.rect(bx, metY, newW, 10).fill(blue); bx += newW;
      doc.rect(bx, metY, recW, 10).fill(gold); bx += recW;
      doc.rect(bx, metY, lapW, 10).fill(red);
      metY += 14;
      doc.fontSize(6).fillColor(green).text('\u25A0 Retained ' + fmtN(retention.retained), rightX + 4, metY, { continued: true, width: barTotalW });
      doc.fillColor(blue).text('  \u25A0 New ' + fmtN(retention.brand_new), { continued: true });
      doc.fillColor(gold).text('  \u25A0 Recovered ' + fmtN(retention.recovered), { continued: true });
      doc.fillColor(red).text('  \u25A0 Lapsed ' + fmtN(retention.lapsed), { continued: false });
    }
  }

  // ── FOOTER ──
  const footerY = pageH - 22;
  doc.moveTo(mL, footerY - 4).lineTo(mL + contentW, footerY - 4).strokeColor(gold).lineWidth(0.8).stroke();
  doc.fontSize(7).fillColor(gray).text(
    'Generated by Fund-Raise  |  ' + today + '  |  Confidential — for board use only',
    mL, footerY, { width: contentW, align: 'center' }
  );

  doc.end();
}, 'Board Report PDF'));

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------
router.get('/crm/anomalies', ensureAuth, (req, res) => {
  res.render('crm/anomalies', { title: 'Anomaly Detection' });
});

router.get('/crm/anomalies/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const dateRange = fyToDateRange(req.query.fy);
  const [data, fiscalYears] = await Promise.all([
    getAnomalyDetection(tenantId, dateRange),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'Anomaly Detection'));

// ---------------------------------------------------------------------------
// AI Recommendations
// ---------------------------------------------------------------------------
router.get('/crm/recommendations', ensureAuth, (req, res) => {
  res.render('crm/recommendations', { title: 'AI Recommendations' });
});

router.get('/crm/recommendations/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const [recs, fiscalYears] = await Promise.all([
    getAIRecommendations(tenantId, fy),
    getFiscalYears(tenantId),
  ]);
  res.json({ recommendations: recs, fiscalYears, selectedFY: fy });
}, 'AI Recommendations'));

// ---------------------------------------------------------------------------
// Entity Detail (Fund, Campaign, Appeal)
// IMPORTANT: This wildcard route must come AFTER all specific /crm/* routes
// ---------------------------------------------------------------------------
router.get('/crm/:entityType/:entityId', ensureAuth, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    if (!['fund', 'campaign', 'appeal'].includes(entityType)) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Invalid entity type.' });
    }
    res.render('crm/entity-detail', {
      title: entityType.charAt(0).toUpperCase() + entityType.slice(1) + ' Detail',
      entityType,
      entityId,
    });
  } catch (err) {
    console.error('[Entity Detail]', err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/crm/:entityType/:entityId/data', ensureAuth, withTimeout(async (req, res) => {
    const { entityType, entityId } = req.params;
    if (!['fund', 'campaign', 'appeal'].includes(entityType)) {
      return res.status(400).json({ error: 'Invalid entity type' });
    }
    const dateRange = fyToDateRange(req.query.fy);
    const [data, fiscalYears] = await Promise.all([
      getEntityDetail(req.user.tenantId, entityType, entityId, dateRange),
      getFiscalYears(req.user.tenantId),
    ]);
    res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null, entityType, entityId });
}, 'Entity Detail Data'));

// ---------------------------------------------------------------------------
// Fundraiser Goal Tracking
// ---------------------------------------------------------------------------
router.get('/fundraiser-goals', ensureAuth, async (req, res) => {
  try {
    res.render('crm/fundraiser-goals', { title: 'Fundraiser Goals' });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message });
  }
});

router.get('/fundraiser-goals/data', ensureAuth, withTimeout(async (req, res) => {
    const tenantId = req.user.tenantId;
    const fy = req.query.fy ? Number(req.query.fy) : null;
    const dateRange = fyToDateRange(fy);
    const [leaderboard, goals, fiscalYears] = await Promise.all([
      getFundraiserLeaderboard(tenantId, dateRange),
      getFundraiserGoals(tenantId, fy),
      getFiscalYears(tenantId),
    ]);

    // Merge goals into leaderboard
    const goalMap = {};
    goals.forEach(g => { goalMap[g.fundraiserName] = Number(g.goalAmount); });
    const merged = leaderboard.map(f => ({
      ...f,
      goal: goalMap[f.fundraiser_name] || null,
      pct: goalMap[f.fundraiser_name] ? Math.round(Number(f.total_credited) / goalMap[f.fundraiser_name] * 100) : null,
    }));

    res.json({ fundraisers: merged, fiscalYears, selectedFY: fy });
}, 'Fundraiser Goals'));

router.post('/fundraiser-goals', ensureAuth, async (req, res) => {
  try {
    const { fundraiserName, fiscalYear, goalAmount } = req.body;
    if (!fundraiserName || !fiscalYear || !goalAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    await setFundraiserGoal(req.user.tenantId, fundraiserName, Number(fiscalYear), Number(goalAmount));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Set Goal]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/fundraiser-goals', ensureAuth, async (req, res) => {
  try {
    const { fundraiserName, fiscalYear } = req.body;
    await deleteFundraiserGoal(req.user.tenantId, fundraiserName, Number(fiscalYear));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Delete Goal]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
