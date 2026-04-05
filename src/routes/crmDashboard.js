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
// LYBUNT / SYBUNT Dashboard
// ---------------------------------------------------------------------------
router.get('/crm/lybunt-sybunt', ensureAuth, (req, res) => {
  res.render('crm/lybunt-sybunt', { title: 'LYBUNT / SYBUNT' });
});

router.get('/crm/lybunt-sybunt/data', ensureAuth, withTimeout(async (req, res) => {
  const tenantId = req.user.tenantId;
  const fy = req.query.fy ? Number(req.query.fy) : null;
  const [data, fiscalYears] = await Promise.all([
    getLybuntSybunt(tenantId, fy),
    getFiscalYears(tenantId),
  ]);
  res.json({ ...data, fiscalYears, selectedFY: fy });
}, 'LYBUNT/SYBUNT'));

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
