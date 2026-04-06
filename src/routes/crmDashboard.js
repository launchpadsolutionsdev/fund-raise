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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const segment = req.query.segment || undefined;
    const [data, fiscalYears] = await Promise.all([
      getDonorScoring(tenantId, dateRange, { page, limit, segment }),
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const pattern = req.query.pattern || undefined;
    const [data, fiscalYears] = await Promise.all([
      getRecurringDonorAnalysis(tenantId, dateRange, { page, limit, pattern }),
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const [data, fiscalYears] = await Promise.all([
      getAcknowledgmentTracker(tenantId, dateRange, { page, limit }),
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
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const [data, fiscalYears] = await Promise.all([
      getGiftTrendAnalysis(tenantId, dateRange, { page, limit }),
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
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const category = (req.query.category === 'LYBUNT' || req.query.category === 'SYBUNT') ? req.query.category : undefined;
  const yearsSince = ['1', '2-3', '4-5', '5+'].includes(req.query.yearsSince) ? req.query.yearsSince : undefined;
  const gaveInFyStart = req.query.gaveInFyStart ? Number(req.query.gaveInFyStart) : undefined;
  const gaveInFyEnd = req.query.gaveInFyEnd ? Number(req.query.gaveInFyEnd) : undefined;
  const notInFyStart = req.query.notInFyStart ? Number(req.query.notInFyStart) : undefined;
  const notInFyEnd = req.query.notInFyEnd ? Number(req.query.notInFyEnd) : undefined;
  const validSegments = ['recently-lapsed', 'long-lapsed', 'high-value-lapsed', 'frequent-gone-quiet', 'one-and-done'];
  const segment = validSegments.includes(req.query.segment) ? req.query.segment : undefined;
  const data = await getLybuntSybunt(tenantId, fy, { page, limit, category, yearsSince, gaveInFyStart, gaveInFyEnd, notInFyStart, notInFyEnd, segment });
  res.json({ ...(data || {}), fiscalYears, selectedFY: fy });
}, 'LYBUNT/SYBUNT'));

router.get('/crm/lybunt-sybunt/export', ensureAuth, withTimeout(async (req, res) => {
  const XLSX = require('xlsx');
  const tenantId = req.user.tenantId;
  const fiscalYears = await getFiscalYears(tenantId);
  const fy = req.query.fy ? Number(req.query.fy) : (fiscalYears && fiscalYears.length ? fiscalYears[0].fy : null);
  const category = (req.query.category === 'LYBUNT' || req.query.category === 'SYBUNT') ? req.query.category : undefined;
  const yearsSince = ['1', '2-3', '4-5', '5+'].includes(req.query.yearsSince) ? req.query.yearsSince : undefined;
  const gaveInFyStart = req.query.gaveInFyStart ? Number(req.query.gaveInFyStart) : undefined;
  const gaveInFyEnd = req.query.gaveInFyEnd ? Number(req.query.gaveInFyEnd) : undefined;
  const notInFyStart = req.query.notInFyStart ? Number(req.query.notInFyStart) : undefined;
  const notInFyEnd = req.query.notInFyEnd ? Number(req.query.notInFyEnd) : undefined;
  const validSegments = ['recently-lapsed', 'long-lapsed', 'high-value-lapsed', 'frequent-gone-quiet', 'one-and-done'];
  const segment = validSegments.includes(req.query.segment) ? req.query.segment : undefined;
  const data = await getLybuntSybunt(tenantId, fy, { page: 1, limit: 50000, category, yearsSince, gaveInFyStart, gaveInFyEnd, notInFyStart, notInFyEnd, segment });
  const donors = (data && data.topDonors) ? data.topDonors : [];

  const rows = donors.map(d => ({
    'First Name': d.first_name || '',
    'Last Name': d.last_name || '',
    'Email': d.constituent_email || '',
    'Phone': d.constituent_phone || '',
    'Address': d.constituent_address || '',
    'City': d.constituent_city || '',
    'State': d.constituent_state || '',
    'Zip': d.constituent_zip || '',
    'Constituent ID': d.constituent_id || '',
    'Category': d.category || '',
    'Last Year Giving': Number(d.last_year_giving || 0),
    'Lifetime Giving': Number(d.lifetime_giving || 0),
    'Total Gifts': Number(d.total_gifts || 0),
    'Consecutive Years': Number(d.consecutive_years || 1),
    'Giving Trend': d.giving_trend || 'one-time',
    'Last Gift Date': d.last_gift_date ? d.last_gift_date.split('T')[0] : '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  // Set column widths
  ws['!cols'] = [
    { wch: 16 }, { wch: 20 }, { wch: 28 }, { wch: 16 },
    { wch: 30 }, { wch: 16 }, { wch: 10 }, { wch: 10 },
    { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 10 },
    { wch: 16 }, { wch: 14 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'LYBUNT-SYBUNT');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const label = category || 'All';
  const filename = 'LYBUNT_SYBUNT_' + label + (fy ? '_FY' + fy : '') + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send(buf);
}, 'LYBUNT/SYBUNT Export'));

// ---------------------------------------------------------------------------
// Donor Upgrade / Downgrade Tracking
// ---------------------------------------------------------------------------
router.get('/crm/donor-upgrade-downgrade', ensureAuth, (req, res) => {
  res.render('crm/donor-upgrade-downgrade', { title: 'Donor Upgrade / Downgrade' });
});

router.get('/crm/donor-upgrade-downgrade/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const category = req.query.category || undefined;
  const [data, fiscalYears] = await Promise.all([
    getDonorUpgradeDowngrade(tenantId, fy, { page, limit, category }),
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
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const [data, fiscalYears] = await Promise.all([
    getFirstTimeDonorConversion(tenantId, dateRange, { page, limit }),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...data, fiscalYears, selectedFY: req.query.fy ? Number(req.query.fy) : null });
}, 'First-Time Donors'));

// ---------------------------------------------------------------------------
// Reports Hub — replaces Board Report as the main reports page
// ---------------------------------------------------------------------------
router.get('/crm/reports', ensureAuth, (req, res) => {
  res.render('crm/reports', { title: 'Reports' });
});

router.get('/crm/reports/fiscal-years', ensureAuth, async (req, res) => {
  const fiscalYears = await getFiscalYears(req.user.tenantId);
  res.json(fiscalYears);
});

router.get('/crm/reports/pdf', ensureAuth, withTimeout(async (req, res) => {
  const generators = require('../services/pdfReportGenerators');
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const report = req.query.report;
  const dateRange = fy ? fyToDateRange(fy) : null;
  const priorDateRange = fy ? fyToDateRange(fy - 1) : null;

  switch (report) {
    case 'executive-summary': {
      const [overview, topDonors, topFunds, topCampaigns, pyramid] = await Promise.all([
        getCrmOverview(tenantId, dateRange),
        getTopDonors(tenantId, dateRange),
        getTopFunds(tenantId, dateRange),
        getTopCampaigns(tenantId, dateRange),
        getGivingPyramid(tenantId, dateRange),
      ]);
      let priorOverview = null, retention = null;
      if (priorDateRange) {
        [priorOverview, retention] = await Promise.all([
          getCrmOverview(tenantId, priorDateRange),
          getDonorRetention(tenantId, fy),
        ]);
      }
      return await generators.generateExecutiveSummary(res, fy, {
        overview, priorOverview,
        topDonors: topDonors.slice(0, 10),
        topFunds: topFunds.slice(0, 10),
        topCampaigns: topCampaigns.slice(0, 10),
        pyramid, retention,
      });
    }
    case 'retention': {
      if (!fy) return res.status(400).json({ error: 'Fiscal year required for Retention Report' });
      const [retention, drilldown] = await Promise.all([
        getDonorRetention(tenantId, fy),
        getRetentionDrilldown(tenantId, fy),
      ]);
      return generators.generateRetentionReport(res, fy, { retention, drilldown });
    }
    case 'scoring': {
      const data = await getDonorScoring(tenantId, dateRange, { page: 1, limit: 50 });
      return generators.generateScoringReport(res, fy, data);
    }
    case 'recurring': {
      const data = await getRecurringDonorAnalysis(tenantId, dateRange, { page: 1, limit: 50 });
      return generators.generateRecurringReport(res, fy, data);
    }
    case 'lybunt': {
      if (!fy) return res.status(400).json({ error: 'Fiscal year required for LYBUNT/SYBUNT Report' });
      const data = await getLybuntSybunt(tenantId, fy, { page: 1, limit: 50 });
      return generators.generateLybuntReport(res, fy, data);
    }
    case 'gift-trends': {
      const data = await getGiftTrendAnalysis(tenantId, dateRange, { page: 1, limit: 50 });
      return generators.generateGiftTrendsReport(res, fy, data);
    }
    case 'campaign': {
      const data = await getCampaignComparison(tenantId, dateRange);
      return generators.generateCampaignReport(res, fy, data);
    }
    case 'fund-health': {
      const data = await getFundHealthReport(tenantId, dateRange);
      return generators.generateFundHealthReport(res, fy, data);
    }
    case 'lifecycle': {
      const data = await getDonorLifecycleAnalysis(tenantId, dateRange);
      return generators.generateLifecycleReport(res, fy, data);
    }
    case 'upgrade-downgrade': {
      if (!fy) return res.status(400).json({ error: 'Fiscal year required for Upgrade/Downgrade Report' });
      const data = await getDonorUpgradeDowngrade(tenantId, fy, { page: 1, limit: 50 });
      return generators.generateUpgradeDowngradeReport(res, fy, data);
    }
    default:
      return res.status(400).json({ error: 'Unknown report type: ' + report });
  }
}, 'Report PDF'));

// ---------------------------------------------------------------------------
// Board-Ready PDF Report — uses PDFKit for server-side generation (legacy)
// ---------------------------------------------------------------------------
router.get('/crm/board-report', ensureAuth, (req, res) => {
  res.render('crm/board-report', { title: 'Board Report' });
});

router.get('/crm/board-report/pdf', ensureAuth, withTimeout(async (req, res) => {
  const PDFDocument = require('pdfkit');
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
    getDepartmentAnalytics(tenantId, dateRange),
    getFundraiserLeaderboard(tenantId, dateRange),
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
  const deptData = results[6] || {};
  const fundraiserData = results[7] || [];
  const priorOverview = priorDateRange ? results[8] : null;
  const retention = priorDateRange ? results[9] : null;
  const departments = (deptData.summary || []).slice(0, 6);
  const topFundraisers = fundraiserData.slice(0, 10);

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
  const fyLabel = fy ? 'FY' + fy + ' (Apr ' + (fy - 1) + ' \u2013 Mar ' + fy + ')' : 'All Time';
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

  // Create PDF — landscape letter, tight margins
  const doc = new PDFDocument({
    size: 'letter',
    layout: 'landscape',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const filename = 'Board_Report' + (fy ? '_FY' + fy : '') + '_' + new Date().toISOString().split('T')[0] + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);

  const PW = 792; // page width (letter landscape)
  const PH = 612; // page height
  const M = 28;   // margin
  const CW = PW - M * 2; // content width

  // ════════════════════════════════════════════════════════════════════
  // HEADER BAR (0–44)
  // ════════════════════════════════════════════════════════════════════
  doc.rect(0, 0, PW, 44).fill(navy);
  doc.fontSize(16).fillColor(white).text(orgName, M + 4, 11, { width: 300 });
  doc.fontSize(9).fillColor(gold).text('Board Report', M + 4, 30, { width: 200 });
  doc.fontSize(9).fillColor(white).text(fyLabel, PW / 2 - 100, 16, { width: 200, align: 'center' });
  doc.fontSize(7).fillColor('#94a3b8').text('Date Pulled: ' + today, PW - M - 160, 18, { width: 156, align: 'right' });

  // ════════════════════════════════════════════════════════════════════
  // 4 HERO KPI CARDS (y: 52–104)
  // ════════════════════════════════════════════════════════════════════
  const o = overview;
  const cardY = 52;
  const cardH = 52;
  const cardGap = 8;
  const cardW = (CW - cardGap * 3) / 4;

  const heroKpis = [
    { label: 'Total Raised', value: fmtCompact(o.total_raised), raw: o.total_raised, priorRaw: priorOverview ? priorOverview.total_raised : null },
    { label: 'Total Gifts', value: fmtN(o.total_gifts), raw: o.total_gifts, priorRaw: priorOverview ? priorOverview.total_gifts : null },
    { label: 'Unique Donors', value: fmtN(o.unique_donors), raw: o.unique_donors, priorRaw: priorOverview ? priorOverview.unique_donors : null },
    { label: 'Retention Rate', value: retention ? retention.retention_rate + '%' : 'N/A', raw: null, priorRaw: null },
  ];

  heroKpis.forEach((kpi, i) => {
    const x = M + i * (cardW + cardGap);
    doc.roundedRect(x, cardY, cardW, cardH, 3).fill(lightGray);
    doc.fontSize(18).fillColor(navy).text(kpi.value, x + 8, cardY + 6, { width: cardW - 16 });
    doc.fontSize(7).fillColor(gray).text(kpi.label, x + 8, cardY + 28, { width: cardW - 16 });
    // YoY delta
    if (kpi.priorRaw !== null) {
      const pct = yoyPct(kpi.raw, kpi.priorRaw);
      if (pct !== null) {
        const isUp = Number(pct) >= 0;
        doc.fontSize(7).fillColor(isUp ? green : red)
          .text((isUp ? '+' : '') + pct + '% YoY', x + 8, cardY + 39, { width: cardW - 16 });
      }
    }
    if (i === 3 && retention) {
      const rateNum = Number(retention.retention_rate);
      doc.fontSize(7).fillColor(rateNum >= 50 ? green : red)
        .text(fmtN(retention.retained) + ' retained / ' + fmtN(retention.lapsed) + ' lapsed', x + 8, cardY + 39, { width: cardW - 16 });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 3-COLUMN TABLES: Donors | Funds | Campaigns (y: 112–290)
  // ════════════════════════════════════════════════════════════════════
  const tblY = 114;
  const tblGap = 12;
  const tblW = (CW - tblGap * 2) / 3;
  const rowH = 15;

  function drawTable(title, items, x, nameKey, valKey) {
    // Title
    doc.fontSize(9).fillColor(navy).text(title, x, tblY, { width: tblW });
    // Header line
    const hdrY = tblY + 14;
    doc.moveTo(x, hdrY).lineTo(x + tblW, hdrY).strokeColor('#d1d5db').lineWidth(0.5).stroke();
    // Column headers
    doc.fontSize(6).fillColor(gray)
      .text('#', x + 2, hdrY + 3, { width: 12 })
      .text('Name', x + 14, hdrY + 3, { width: tblW - 80 })
      .text('Amount', x + tblW - 65, hdrY + 3, { width: 63, align: 'right' });
    const dataStartY = hdrY + 14;
    // Rows
    items.forEach((item, i) => {
      const ry = dataStartY + i * rowH;
      const name = typeof nameKey === 'function' ? nameKey(item) : (item[nameKey] || 'Unknown');
      const val = typeof valKey === 'function' ? valKey(item) : item[valKey];
      const truncName = name.length > 30 ? name.substring(0, 29) + '\u2026' : name;
      // Zebra stripe
      if (i % 2 === 0) doc.rect(x, ry - 1, tblW, rowH).fill('#f9fafb');
      doc.fontSize(8).fillColor(navy)
        .text((i + 1) + '.', x + 2, ry + 1, { width: 12 })
        .text(truncName, x + 14, ry + 1, { width: tblW - 82 })
        .text(val, x + tblW - 66, ry + 1, { width: 64, align: 'right' });
    });
    // Fill empty rows so all columns are same height
    for (let i = items.length; i < 5; i++) {
      const ry = dataStartY + i * rowH;
      if (i % 2 === 0) doc.rect(x, ry - 1, tblW, rowH).fill('#f9fafb');
      doc.fontSize(8).fillColor('#d1d5db').text('\u2014', x + 14, ry + 1, { width: 50 });
    }
    // Bottom line
    const endY = dataStartY + 5 * rowH;
    doc.moveTo(x, endY).lineTo(x + tblW, endY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  }

  // Col 1: Donors
  drawTable('Top 5 Donors', topDonors, M,
    d => ((d.first_name || '') + ' ' + (d.last_name || '')).trim() || d.constituent_name || 'Anonymous',
    d => fmtD(d.total_credited || d.total_given || d.total || 0));

  // Col 2: Funds
  drawTable('Top 5 Funds', topFunds, M + tblW + tblGap,
    'fund_description',
    f => fmtD(f.total));

  // Col 3: Campaigns
  drawTable('Top 5 Campaigns', topCampaigns, M + (tblW + tblGap) * 2,
    'campaign_description',
    c => fmtD(c.total));

  // ════════════════════════════════════════════════════════════════════
  // KEY METRICS BAR (y: 210–240) — single horizontal row
  // ════════════════════════════════════════════════════════════════════
  const metricsY = 218;
  doc.rect(M, metricsY, CW, 24).fill(lightGray);
  const mColW = CW / 4;
  const metrics = [
    ['Avg Gift', fmtD(o.avg_gift)],
    ['Largest Gift', fmtD(o.largest_gift)],
    ['Funds', fmtN(o.unique_funds) + ' unique'],
    ['Campaigns', fmtN(o.unique_campaigns) + '  |  Appeals: ' + fmtN(o.unique_appeals)],
  ];
  metrics.forEach(([lbl, val], i) => {
    const mx = M + i * mColW + 10;
    doc.fontSize(6).fillColor(gray).text(lbl, mx, metricsY + 4, { width: mColW - 20 });
    doc.fontSize(8).fillColor(navy).text(val, mx, metricsY + 13, { width: mColW - 20 });
  });

  // ════════════════════════════════════════════════════════════════════
  // RETENTION BAR (y: 250–286) — only if retention data exists
  // ════════════════════════════════════════════════════════════════════
  const retY = 250;
  if (retention) {
    doc.fontSize(9).fillColor(navy).text('Donor Retention', M, retY, { width: 200 });
    const barY = retY + 14;
    const barH = 12;
    const totalDonors = Number(retention.retained) + Number(retention.lapsed) + Number(retention.brand_new) + Number(retention.recovered);
    if (totalDonors > 0) {
      const retW = (Number(retention.retained) / totalDonors) * CW;
      const newW = (Number(retention.brand_new) / totalDonors) * CW;
      const recW = (Number(retention.recovered) / totalDonors) * CW;
      const lapW = (Number(retention.lapsed) / totalDonors) * CW;
      let bx = M;
      if (retW > 0) { doc.rect(bx, barY, retW, barH).fill(green); bx += retW; }
      if (newW > 0) { doc.rect(bx, barY, newW, barH).fill(blue); bx += newW; }
      if (recW > 0) { doc.rect(bx, barY, recW, barH).fill(gold); bx += recW; }
      if (lapW > 0) { doc.rect(bx, barY, lapW, barH).fill(red); }
      // Legend
      const legY = barY + barH + 4;
      doc.fontSize(6);
      let lx = M;
      doc.rect(lx, legY + 1, 6, 6).fill(green);
      doc.fillColor(gray).text('Retained ' + fmtN(retention.retained), lx + 8, legY, { width: 100 }); lx += 90;
      doc.rect(lx, legY + 1, 6, 6).fill(blue);
      doc.fillColor(gray).text('New ' + fmtN(retention.brand_new), lx + 8, legY, { width: 80 }); lx += 65;
      doc.rect(lx, legY + 1, 6, 6).fill(gold);
      doc.fillColor(gray).text('Recovered ' + fmtN(retention.recovered), lx + 8, legY, { width: 100 }); lx += 90;
      doc.rect(lx, legY + 1, 6, 6).fill(red);
      doc.fillColor(gray).text('Lapsed ' + fmtN(retention.lapsed), lx + 8, legY, { width: 80 });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // GIVING PYRAMID — full-width horizontal bars (y: 296–rest)
  // ════════════════════════════════════════════════════════════════════
  const pyrY = retention ? 296 : 258;
  if (pyramid && pyramid.length) {
    doc.fontSize(9).fillColor(navy).text('Giving Pyramid', M, pyrY, { width: 200 });
    const pyrStartY = pyrY + 14;
    doc.moveTo(M, pyrStartY).lineTo(M + CW, pyrStartY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // Layout: label (90px) | bar (flexible) | value (60px) | donors (50px)
    const labelW = 80;
    const valW = 55;
    const donorW = 60;
    const barAreaStart = M + labelW;
    const barAreaW = CW - labelW - valW - donorW - 10;
    const maxTotal = Math.max(...pyramid.map(p => Number(p.total || p.band_total || 0)), 1);

    // Column headers
    doc.fontSize(6).fillColor(gray)
      .text('Gift Range', M, pyrStartY + 3, { width: labelW })
      .text('Donors', M + CW - donorW, pyrStartY + 3, { width: donorW, align: 'right' });

    const pyrRowH = pyramid.length <= 7 ? 16 : 13;
    const pyrDataY = pyrStartY + 12;

    // Color gradient for bars (light blue to dark blue)
    const barColors = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'];

    pyramid.forEach((p, i) => {
      const ry = pyrDataY + i * pyrRowH;
      const total = Number(p.total || p.band_total || 0);
      const donors = Number(p.donors || p.donor_count || 0);
      const barW = Math.max(2, (total / maxTotal) * barAreaW);
      const band = p.band || '';

      // Zebra
      if (i % 2 === 0) doc.rect(M, ry - 1, CW, pyrRowH).fill('#fafbfc');

      // Label
      doc.fontSize(7).fillColor(gray).text(band, M + 2, ry + 3, { width: labelW - 6 });
      // Bar
      const barColor = barColors[Math.min(i, barColors.length - 1)];
      doc.rect(barAreaStart, ry + 1, barW, pyrRowH - 5).fill(barColor);
      // Amount inside or next to bar
      doc.fontSize(7).fillColor(navy).text(fmtCompact(total), barAreaStart + barW + 4, ry + 3, { width: valW });
      // Donor count
      doc.fontSize(7).fillColor(gray).text(fmtN(donors), M + CW - donorW, ry + 3, { width: donorW - 4, align: 'right' });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // DEPARTMENT PERFORMANCE — compact strip below pyramid
  // ════════════════════════════════════════════════════════════════════
  const pyrRows = (pyramid && pyramid.length) ? pyramid.length : 0;
  const pyrRowHActual = pyrRows <= 7 ? 16 : 13;
  const deptY = pyrY + 14 + 12 + pyrRows * pyrRowHActual + 8;

  if (departments.length > 0) {
    doc.fontSize(8).fillColor(navy).text('Department Performance', M, deptY, { width: 200 });
    const deptBarY = deptY + 12;
    const deptColW = CW / Math.min(departments.length, 6);
    const deptLabels = {
      annual_giving: 'Annual Giving',
      direct_mail: 'Direct Mail',
      events: 'Events',
      major_gifts: 'Major Gifts',
      legacy_giving: 'Legacy Giving',
      corporate: 'Corporate',
    };
    doc.rect(M, deptBarY, CW, 63).fill(lightGray);
    departments.forEach((d, i) => {
      const dx = M + i * deptColW + 6;
      const label = deptLabels[d.department] || d.department || 'Other';
      doc.fontSize(8).fillColor(gray).text(label, dx, deptBarY + 6, { width: deptColW - 12 });
      doc.fontSize(12).fillColor(navy).text(fmtCompact(d.total_amount), dx, deptBarY + 22, { width: deptColW - 12 });
      doc.fontSize(7).fillColor(gray).text(fmtN(d.gift_count) + ' gifts / ' + fmtN(d.donor_count) + ' donors', dx, deptBarY + 42, { width: deptColW - 12 });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // PAGE 1 FOOTER
  // ════════════════════════════════════════════════════════════════════
  const footY = PH - 18;
  doc.moveTo(M, footY - 3).lineTo(M + CW, footY - 3).strokeColor(gold).lineWidth(0.6).stroke();
  doc.fontSize(6).fillColor(gray).text(
    'Generated by Fund-Raise  |  ' + today + '  |  Confidential - for board use only',
    M, footY, { width: CW, align: 'center' }
  );

  // ════════════════════════════════════════════════════════════════════
  // PAGE 2 — Top 10 Fundraiser Performance
  // ════════════════════════════════════════════════════════════════════
  if (topFundraisers.length > 0) {
    doc.addPage({ size: 'letter', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } });

    // Header bar
    doc.rect(0, 0, PW, 38).fill(navy);
    doc.fontSize(14).fillColor(white).text(orgName, M + 4, 9, { width: 300 });
    doc.fontSize(8).fillColor(gold).text('Fundraiser Performance  |  ' + fyLabel, M + 4, 25, { width: 400 });
    doc.fontSize(7).fillColor('#94a3b8').text(today, PW - M - 130, 15, { width: 126, align: 'right' });

    // Top 10 Fundraisers table
    const frY = 54;
    doc.fontSize(11).fillColor(navy).text('Top 10 Fundraiser Performance', M, frY, { width: 400 });
    const frHdrY = frY + 18;
    doc.moveTo(M, frHdrY).lineTo(M + CW, frHdrY).strokeColor('#d1d5db').lineWidth(0.5).stroke();

    // Column layout
    const frCols = {
      rank: { x: M + 4, w: 20 },
      name: { x: M + 28, w: 240 },
      gifts: { x: M + 280, w: 80 },
      donors: { x: M + 370, w: 80 },
      raised: { x: M + 470, w: 120 },
      bar: { x: M + 596, w: CW - 600 },
    };

    // Column headers
    doc.fontSize(7).fillColor(gray)
      .text('#', frCols.rank.x, frHdrY + 4, { width: frCols.rank.w })
      .text('Fundraiser', frCols.name.x, frHdrY + 4, { width: frCols.name.w })
      .text('Gifts', frCols.gifts.x, frHdrY + 4, { width: frCols.gifts.w, align: 'right' })
      .text('Donors', frCols.donors.x, frHdrY + 4, { width: frCols.donors.w, align: 'right' })
      .text('Total Raised', frCols.raised.x, frHdrY + 4, { width: frCols.raised.w, align: 'right' });

    const frDataY = frHdrY + 18;
    const frRowH = 22;
    const maxRaised = Math.max(...topFundraisers.map(f => Number(f.total_credited || f.total_gift_amount || 0)), 1);

    topFundraisers.forEach((f, i) => {
      const ry = frDataY + i * frRowH;
      const name = ((f.fundraiser_first_name || '') + ' ' + (f.fundraiser_last_name || '')).trim() || f.fundraiser_name || 'Unknown';
      const truncName = name.length > 35 ? name.substring(0, 34) + '...' : name;
      const raised = Number(f.total_credited || f.total_gift_amount || 0);
      const barW = Math.max(2, (raised / maxRaised) * frCols.bar.w);

      // Zebra stripe
      if (i % 2 === 0) doc.rect(M, ry - 2, CW, frRowH).fill('#f9fafb');

      doc.fontSize(9).fillColor(navy)
        .text((i + 1) + '.', frCols.rank.x, ry + 3, { width: frCols.rank.w })
        .text(truncName, frCols.name.x, ry + 3, { width: frCols.name.w });
      doc.fontSize(9).fillColor(gray)
        .text(fmtN(f.gift_count), frCols.gifts.x, ry + 3, { width: frCols.gifts.w, align: 'right' })
        .text(fmtN(f.donor_count), frCols.donors.x, ry + 3, { width: frCols.donors.w, align: 'right' });
      doc.fontSize(9).fillColor(navy)
        .text(fmtD(raised), frCols.raised.x, ry + 3, { width: frCols.raised.w, align: 'right' });

      // Mini bar chart
      const barColor = i < 3 ? blue : '#93c5fd';
      doc.rect(frCols.bar.x, ry + 2, barW, frRowH - 7).fill(barColor);
    });

    // Bottom line
    const frEndY = frDataY + topFundraisers.length * frRowH;
    doc.moveTo(M, frEndY).lineTo(M + CW, frEndY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // Page 2 footer
    const foot2Y = PH - 18;
    doc.moveTo(M, foot2Y - 3).lineTo(M + CW, foot2Y - 3).strokeColor(gold).lineWidth(0.6).stroke();
    doc.fontSize(6).fillColor(gray).text(
      'Generated by Fund-Raise  |  ' + today + '  |  Confidential - for board use only  |  Page 2',
      M, foot2Y, { width: CW, align: 'center' }
    );
  }

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
