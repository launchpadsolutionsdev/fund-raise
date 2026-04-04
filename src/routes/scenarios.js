const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { Snapshot, DepartmentSummary } = require('../models');

// ── Page ──
router.get('/scenario-planner', ensureAuth, (req, res) => {
  res.render('scenarios/index', { title: 'Scenario Planner' });
});

// ── API: Get base data for scenarios ──
router.get('/api/scenarios/base-data', ensureAuth, async (req, res) => {
  try {
    const snapshot = await Snapshot.findOne({
      where: { tenantId: req.user.tenantId },
      order: [['snapshotDate', 'DESC']],
    });

    if (!snapshot) return res.json({ departments: [], snapshotDate: null });

    const depts = await DepartmentSummary.findAll({
      where: { snapshotId: snapshot.id },
    });

    const deptLabels = {
      annual_giving: 'Annual Giving', direct_mail: 'Direct Mail',
      events: 'Events', major_gifts: 'Major Gifts', legacy_giving: 'Legacy Giving',
    };

    const data = depts.map(d => ({
      slug: d.department,
      label: deptLabels[d.department] || d.department,
      raised: parseFloat(d.totalAmount) || 0,
      goal: parseFloat(d.goal) || 0,
      gifts: d.totalGifts || 0,
      avgGift: d.totalGifts > 0 ? (parseFloat(d.totalAmount) || 0) / d.totalGifts : 0,
    }));

    res.json({ departments: data, snapshotDate: snapshot.snapshotDate });
  } catch (err) {
    console.error('[Scenarios]', err.message);
    res.status(500).json({ error: 'Failed to load scenario data' });
  }
});

module.exports = router;
