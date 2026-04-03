const router = require('express').Router();
const { Op } = require('sequelize');
const { ensureAuth } = require('../middleware/auth');
const {
  Snapshot, DepartmentSummary, GiftTypeBreakdown,
  SourceBreakdown, FundBreakdown, RawGift,
} = require('../models');
const {
  getAvailableDates,
  getEnhancedDashboardData,
  getDepartmentEnhancedData,
  getCrossDepartmentData,
  getTrendsEnhanced,
  getSnapshotComparison,
  getGiftSeasonality,
  getProjection,
  getOperationalMetrics,
} = require('../services/snapshotService');

const DEPT_LABELS = {
  annual_giving: 'Annual Giving',
  direct_mail: 'Direct Mail',
  events: 'Events',
  major_gifts: 'Major Gifts',
  legacy_giving: 'Legacy Giving',
};

async function findSnapshot(tenantId, dateStr) {
  return Snapshot.findOne({ where: { tenantId, snapshotDate: dateStr } });
}

router.get('/dates', ensureAuth, async (req, res) => {
  const dates = await getAvailableDates(req.user.tenantId);
  res.json(dates);
});

router.get('/snapshot/:date/summary', ensureAuth, async (req, res) => {
  const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const summaries = await DepartmentSummary.findAll({ where: { snapshotId: snapshot.id } });
  const result = {};
  for (const s of summaries) {
    result[s.department] = {
      label: DEPT_LABELS[s.department] || s.department,
      totalGifts: s.totalGifts,
      totalAmount: parseFloat(s.totalAmount) || 0,
      goal: parseFloat(s.goal) || 0,
      pctToGoal: parseFloat(s.pctToGoal) || 0,
    };
    if (s.department === 'events') {
      result[s.department].thirdPartyTotalGifts = s.thirdPartyTotalGifts;
      result[s.department].thirdPartyTotalAmount = parseFloat(s.thirdPartyTotalAmount) || 0;
      result[s.department].thirdPartyGoal = parseFloat(s.thirdPartyGoal) || 0;
      result[s.department].thirdPartyPctToGoal = parseFloat(s.thirdPartyPctToGoal) || 0;
    }
    if (s.department === 'legacy_giving') {
      result[s.department].avgGift = parseFloat(s.avgGift) || 0;
      result[s.department].newExpectancies = s.newExpectancies;
      result[s.department].openEstates = s.openEstates;
    }
  }
  res.json(result);
});

router.get('/snapshot/:date/gift-types/:department', ensureAuth, async (req, res) => {
  const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const rows = await GiftTypeBreakdown.findAll({
    where: { snapshotId: snapshot.id, department: req.params.department },
  });
  res.json(rows.map(r => ({
    giftType: r.giftType,
    amount: r.amount,
    pct: parseFloat(r.pctOfGifts) || 0,
  })));
});

router.get('/snapshot/:date/sources/:department', ensureAuth, async (req, res) => {
  const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const rows = await SourceBreakdown.findAll({
    where: { snapshotId: snapshot.id, department: req.params.department },
  });
  res.json(rows.map(r => ({
    source: r.source,
    amount: r.amount,
    pct: parseFloat(r.pctOfGifts) || 0,
  })));
});

router.get('/snapshot/:date/funds/:department', ensureAuth, async (req, res) => {
  const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const rows = await FundBreakdown.findAll({
    where: { snapshotId: snapshot.id, department: req.params.department },
  });
  res.json(rows.map(r => ({
    fundName: r.fundName,
    category: r.category,
    amount: parseFloat(r.amount) || 0,
    pctOfTotal: parseFloat(r.pctOfTotal) || 0,
    onetimeCount: r.onetimeCount,
    recurringCount: r.recurringCount,
    onlineCount: r.onlineCount,
    mailedInCount: r.mailedInCount,
    totalCount: r.totalCount,
  })));
});

router.get('/snapshot/:date/raw/:department', ensureAuth, async (req, res) => {
  const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const page = parseInt(req.query.page) || 1;
  const perPage = parseInt(req.query.per_page) || 50;
  const search = req.query.search || '';
  const sortBy = req.query.sort || 'splitAmount';
  const sortDir = req.query.order === 'ASC' ? 'ASC' : 'DESC';
  const offset = (page - 1) * perPage;

  const allowedSortCols = ['splitAmount', 'giftDate', 'primaryAddressee', 'fundDescription', 'giftType', 'appealId'];
  const orderCol = allowedSortCols.includes(sortBy) ? sortBy : 'splitAmount';

  const where = { snapshotId: snapshot.id, department: req.params.department };
  if (search) {
    where[Op.or] = [
      { primaryAddressee: { [Op.iLike]: `%${search}%` } },
      { fundDescription: { [Op.iLike]: `%${search}%` } },
      { appealId: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { count, rows } = await RawGift.findAndCountAll({
    where,
    order: [[orderCol, sortDir]],
    limit: perPage,
    offset,
  });

  res.json({
    gifts: rows.map(g => ({
      primaryAddressee: g.primaryAddressee,
      appealId: g.appealId,
      splitAmount: parseFloat(g.splitAmount) || 0,
      fundDescription: g.fundDescription,
      giftId: g.giftId,
      giftType: g.giftType,
      giftReference: g.giftReference,
      giftDate: g.giftDate,
      extraField: g.extraField,
    })),
    total: count,
    page,
    pages: Math.ceil(count / perPage),
  });
});

router.get('/trends', ensureAuth, async (req, res) => {
  const snapshots = await Snapshot.findAll({
    where: { tenantId: req.user.tenantId },
    order: [['snapshotDate', 'ASC']],
  });

  const data = [];
  for (const snap of snapshots) {
    const summaries = await DepartmentSummary.findAll({ where: { snapshotId: snap.id } });
    const entry = { date: snap.snapshotDate, departments: {} };
    for (const s of summaries) {
      entry.departments[s.department] = {
        totalAmount: parseFloat(s.totalAmount) || 0,
        totalGifts: s.totalGifts || 0,
      };
    }
    data.push(entry);
  }
  res.json(data);
});

// Enhanced metrics for main dashboard
router.get('/snapshot/:date/enhanced', ensureAuth, async (req, res) => {
  try {
    const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    const data = await getEnhancedDashboardData(snapshot);
    res.json(data);
  } catch (err) { console.error('[API enhanced]', err.message); res.status(500).json({ error: err.message }); }
});

// Enhanced metrics for a department
router.get('/snapshot/:date/department-enhanced/:department', ensureAuth, async (req, res) => {
  try {
    const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    const data = await getDepartmentEnhancedData(snapshot, req.params.department);
    res.json(data);
  } catch (err) { console.error('[API dept-enhanced]', err.message); res.status(500).json({ error: err.message }); }
});

// Cross-department analytics
router.get('/snapshot/:date/cross-department', ensureAuth, async (req, res) => {
  try {
    const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    const data = await getCrossDepartmentData(snapshot);
    res.json(data);
  } catch (err) { console.error('[API cross-dept]', err.message); res.status(500).json({ error: err.message }); }
});

// Enhanced trends with cumulative data
router.get('/trends-enhanced', ensureAuth, async (req, res) => {
  try {
    const data = await getTrendsEnhanced(req.user.tenantId);
    res.json(data);
  } catch (err) { console.error('[API trends-enhanced]', err.message); res.status(500).json({ error: err.message }); }
});

// Period-over-period comparison
router.get('/compare', ensureAuth, async (req, res) => {
  try {
    const { date1, date2 } = req.query;
    if (!date1 || !date2) return res.status(400).json({ error: 'date1 and date2 required' });
    const data = await getSnapshotComparison(req.user.tenantId, date1, date2);
    if (!data) return res.status(404).json({ error: 'One or both snapshots not found' });
    res.json(data);
  } catch (err) { console.error('[API compare]', err.message); res.status(500).json({ error: err.message }); }
});

// Gift seasonality by month
router.get('/snapshot/:date/seasonality', ensureAuth, async (req, res) => {
  try {
    const snapshot = await findSnapshot(req.user.tenantId, req.params.date);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    const data = await getGiftSeasonality(snapshot);
    res.json(data);
  } catch (err) { console.error('[API seasonality]', err.message); res.status(500).json({ error: err.message }); }
});

// Year-end projection
router.get('/projection', ensureAuth, async (req, res) => {
  try {
    const data = await getProjection(req.user.tenantId);
    res.json(data || {});
  } catch (err) { console.error('[API projection]', err.message); res.status(500).json({ error: err.message }); }
});

// Operational / data freshness metrics
router.get('/operational', ensureAuth, async (req, res) => {
  try {
    const data = await getOperationalMetrics(req.user.tenantId);
    res.json(data);
  } catch (err) { console.error('[API operational]', err.message); res.status(500).json({ error: err.message }); }
});

module.exports = router;
