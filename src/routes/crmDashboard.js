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
  const data = await getLybuntSybunt(tenantId, fy, { page, limit, category });
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
      return generators.generateExecutiveSummary(res, fy, {
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

  // Fetch all data
  const [overview, fiscalYears] = await Promise.all([
    getCrmOverview(tenantId, dateRange),
    getFiscalYears(tenantId),
  ]);

  const batch2 = [
    getTopDonors(tenantId, dateRange),
    getTopFunds(tenantId, dateRange),
    getTopCampaigns(tenantId, dateRange),
    getGivingPyramid(tenantId, dateRange),
  ];
  if (priorDateRange) {
    batch2.push(getCrmOverview(tenantId, priorDateRange));
    batch2.push(getDonorRetention(tenantId, fy));
  }
  const b2 = await Promise.all(batch2);
  const topDonors = b2[0].slice(0, 10);
  const topFunds = b2[1].slice(0, 10);
  const topCampaigns = b2[2].slice(0, 10);
  const pyramid = b2[3];
  const priorOverview = priorDateRange ? b2[4] : null;
  const retention = priorDateRange ? b2[5] : null;

  const fmtN = n => Number(n || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
  const fmtD = n => '$' + fmtN(n);
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fyLabel = fy ? 'FY' + fy + ' (Apr ' + (fy-1) + ' – Mar ' + fy + ')' : 'All Time';

  // Create PDF
  const doc = new PDFDocument({ size: 'letter', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  const filename = 'Board_Report' + (fy ? '_FY' + fy : '') + '_' + new Date().toISOString().split('T')[0] + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);

  // Colors
  const blue = '#0072BB';
  const navy = '#003B5C';
  const gold = '#D4A843';
  const gray = '#6b7280';
  const green = '#16a34a';
  const red = '#dc2626';

  // ── Title Page ──
  doc.fontSize(28).fillColor(navy).text('Fund-Raise', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(20).fillColor(blue).text('Board Report', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor(gray).text(fyLabel, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(gray).text('Generated ' + today, { align: 'center' });

  // Divider
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor(gold).lineWidth(2).stroke();
  doc.moveDown(1);

  // ── Executive Summary KPIs ──
  doc.fontSize(16).fillColor(navy).text('Executive Summary');
  doc.moveDown(0.5);

  const o = overview;
  const kpis = [
    ['Total Raised', fmtD(o.total_raised)],
    ['Total Gifts', fmtN(o.total_gifts)],
    ['Unique Donors', fmtN(o.unique_donors)],
    ['Average Gift', fmtD(o.avg_gift)],
    ['Largest Gift', fmtD(o.largest_gift)],
    ['Unique Funds', fmtN(o.unique_funds)],
    ['Campaigns', fmtN(o.unique_campaigns)],
    ['Appeals', fmtN(o.unique_appeals)],
  ];

  // KPI grid — 2 columns
  const colW = 245;
  const startX = 55;
  kpis.forEach((kpi, i) => {
    const col = i % 2;
    const x = startX + col * colW;
    if (col === 0 && i > 0) doc.moveDown(0.1);
    const y = doc.y;
    doc.fontSize(9).fillColor(gray).text(kpi[0], x, y, { width: 120 });
    doc.fontSize(12).fillColor(navy).text(kpi[1], x + 130, y, { width: 110, align: 'right' });
    if (col === 1) doc.moveDown(0.3);
  });

  // YoY comparison
  if (priorOverview) {
    doc.moveDown(0.8);
    doc.fontSize(14).fillColor(navy).text('Year-over-Year Comparison');
    doc.moveDown(0.3);
    const p = priorOverview;
    const yoyItems = [
      ['Total Raised', o.total_raised, p.total_raised],
      ['Unique Donors', o.unique_donors, p.unique_donors],
      ['Average Gift', o.avg_gift, p.avg_gift],
    ];
    yoyItems.forEach(([label, cur, prev]) => {
      const curN = Number(cur), prevN = Number(prev);
      const pct = prevN > 0 ? ((curN - prevN) / prevN * 100).toFixed(1) : 'N/A';
      const isUp = curN >= prevN;
      doc.fontSize(9).fillColor(gray).text(label, 55, doc.y, { continued: true, width: 100 });
      doc.fillColor(navy).text('  ' + fmtD(cur), { continued: true });
      doc.fillColor(gray).text('  vs ' + fmtD(prev), { continued: true });
      doc.fillColor(isUp ? green : red).text('  (' + (isUp ? '+' : '') + pct + '%)', { continued: false });
      doc.moveDown(0.2);
    });
  }

  // Retention
  if (retention) {
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor(navy).text('Donor Retention');
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(gray)
      .text('Retention Rate: ', { continued: true })
      .fillColor(Number(retention.retention_rate) >= 50 ? green : red)
      .text(retention.retention_rate + '%', { continued: true })
      .fillColor(gray)
      .text('   |   Retained: ' + fmtN(retention.retained) + '   |   Lapsed: ' + fmtN(retention.lapsed) +
        '   |   New: ' + fmtN(retention.brand_new) + '   |   Recovered: ' + fmtN(retention.recovered));
  }

  // ── Top Donors ──
  doc.addPage();
  doc.fontSize(16).fillColor(navy).text('Top 10 Donors');
  doc.moveDown(0.5);

  // Table header
  const tableX = 55;
  doc.fontSize(8).fillColor(gray);
  doc.text('#', tableX, doc.y, { width: 20 });
  doc.text('Donor Name', tableX + 25, doc.y - 10, { width: 200 });
  doc.text('Total', tableX + 320, doc.y - 10, { width: 80, align: 'right' });
  doc.text('Gifts', tableX + 410, doc.y - 10, { width: 50, align: 'right' });
  doc.moveDown(0.3);
  doc.moveTo(tableX, doc.y).lineTo(510, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  topDonors.forEach((d, i) => {
    const y = doc.y;
    doc.fontSize(9).fillColor(navy);
    doc.text((i+1) + '.', tableX, y, { width: 20 });
    doc.text(d.constituent_name || 'Anonymous', tableX + 25, y, { width: 290 });
    doc.text(fmtD(d.total_credited || d.total_given || 0), tableX + 320, y, { width: 80, align: 'right' });
    doc.text(fmtN(d.gift_count || 0), tableX + 410, y, { width: 50, align: 'right' });
    doc.moveDown(0.2);
  });

  // ── Top Funds ──
  doc.moveDown(1);
  doc.fontSize(16).fillColor(navy).text('Top 10 Funds');
  doc.moveDown(0.5);

  doc.fontSize(8).fillColor(gray);
  doc.text('#', tableX, doc.y, { width: 20 });
  doc.text('Fund', tableX + 25, doc.y - 10, { width: 250 });
  doc.text('Total', tableX + 320, doc.y - 10, { width: 80, align: 'right' });
  doc.text('Gifts', tableX + 410, doc.y - 10, { width: 50, align: 'right' });
  doc.moveDown(0.3);
  doc.moveTo(tableX, doc.y).lineTo(510, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  topFunds.forEach((f, i) => {
    const y = doc.y;
    doc.fontSize(9).fillColor(navy);
    doc.text((i+1) + '.', tableX, y, { width: 20 });
    doc.text(f.fund_description || 'Unknown', tableX + 25, y, { width: 290 });
    doc.text(fmtD(f.total), tableX + 320, y, { width: 80, align: 'right' });
    doc.text(fmtN(f.gift_count), tableX + 410, y, { width: 50, align: 'right' });
    doc.moveDown(0.2);
  });

  // ── Top Campaigns ──
  doc.moveDown(1);
  doc.fontSize(16).fillColor(navy).text('Top 10 Campaigns');
  doc.moveDown(0.5);

  doc.fontSize(8).fillColor(gray);
  doc.text('#', tableX, doc.y, { width: 20 });
  doc.text('Campaign', tableX + 25, doc.y - 10, { width: 250 });
  doc.text('Total', tableX + 320, doc.y - 10, { width: 80, align: 'right' });
  doc.text('Gifts', tableX + 410, doc.y - 10, { width: 50, align: 'right' });
  doc.moveDown(0.3);
  doc.moveTo(tableX, doc.y).lineTo(510, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  topCampaigns.forEach((c, i) => {
    const y = doc.y;
    doc.fontSize(9).fillColor(navy);
    doc.text((i+1) + '.', tableX, y, { width: 20 });
    doc.text(c.campaign_description || 'Unknown', tableX + 25, y, { width: 290 });
    doc.text(fmtD(c.total), tableX + 320, y, { width: 80, align: 'right' });
    doc.text(fmtN(c.gift_count), tableX + 410, y, { width: 50, align: 'right' });
    doc.moveDown(0.2);
  });

  // ── Giving Pyramid ──
  if (pyramid && pyramid.length) {
    doc.addPage();
    doc.fontSize(16).fillColor(navy).text('Giving Pyramid');
    doc.moveDown(0.5);

    doc.fontSize(8).fillColor(gray);
    doc.text('Gift Range', tableX, doc.y, { width: 150 });
    doc.text('Donors', tableX + 160, doc.y - 10, { width: 60, align: 'right' });
    doc.text('Total', tableX + 230, doc.y - 10, { width: 80, align: 'right' });
    doc.text('Avg Gift', tableX + 320, doc.y - 10, { width: 80, align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(tableX, doc.y).lineTo(510, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.moveDown(0.2);

    pyramid.forEach(p => {
      const y = doc.y;
      doc.fontSize(9).fillColor(navy);
      doc.text(p.band, tableX, y, { width: 150 });
      doc.text(fmtN(p.donors), tableX + 160, y, { width: 60, align: 'right' });
      doc.text(fmtD(p.total), tableX + 230, y, { width: 80, align: 'right' });
      doc.text(fmtD(p.avg_gift), tableX + 320, y, { width: 80, align: 'right' });
      doc.moveDown(0.2);
    });
  }

  // Footer
  doc.moveDown(2);
  doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor(gold).lineWidth(1).stroke();
  doc.moveDown(0.5);
  doc.fontSize(8).fillColor(gray).text('Generated by Fund-Raise | ' + today + ' | Confidential — for board use only', { align: 'center' });

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
