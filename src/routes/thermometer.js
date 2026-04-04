const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { Snapshot, DepartmentSummary } = require('../models');

// ── Page ──
router.get('/thermometer', ensureAuth, (req, res) => {
  res.render('thermometer/index', { title: 'Campaign Thermometer' });
});

// ── API: Get thermometer data ──
router.get('/api/thermometer', ensureAuth, async (req, res) => {
  try {
    const { selectedDate } = req.query;
    const whereClause = { tenantId: req.user.tenantId };

    let snapshot;
    if (selectedDate) {
      snapshot = await Snapshot.findOne({
        where: { ...whereClause, snapshotDate: selectedDate },
      });
    }
    if (!snapshot) {
      snapshot = await Snapshot.findOne({
        where: whereClause,
        order: [['snapshotDate', 'DESC']],
      });
    }

    if (!snapshot) return res.json({ departments: [], overall: null, snapshotDate: null });

    const departments = await DepartmentSummary.findAll({
      where: { snapshotId: snapshot.id },
      order: [['department', 'ASC']],
    });

    const deptLabels = {
      annual_giving: 'Annual Giving',
      direct_mail: 'Direct Mail',
      events: 'Events',
      major_gifts: 'Major Gifts',
      legacy_giving: 'Legacy Giving',
    };

    const deptColors = {
      annual_giving: '#0072BB',
      direct_mail: '#143D8D',
      events: '#FFAA00',
      major_gifts: '#16a34a',
      legacy_giving: '#8b5cf6',
    };

    let totalRaised = 0;
    let totalGoal = 0;

    const deptData = departments.map(d => {
      const raised = parseFloat(d.totalAmount) || 0;
      const goal = parseFloat(d.goal) || 0;
      const pct = goal > 0 ? Math.min((raised / goal) * 100, 150) : 0;
      totalRaised += raised;
      totalGoal += goal;

      return {
        slug: d.department,
        label: deptLabels[d.department] || d.department,
        color: deptColors[d.department] || '#0072BB',
        raised,
        goal,
        pct: Math.round(pct * 10) / 10,
        giftCount: d.totalGifts || 0,
      };
    });

    const overallPct = totalGoal > 0 ? Math.min((totalRaised / totalGoal) * 100, 150) : 0;

    res.json({
      departments: deptData,
      overall: {
        raised: totalRaised,
        goal: totalGoal,
        pct: Math.round(overallPct * 10) / 10,
      },
      snapshotDate: snapshot.snapshotDate,
    });
  } catch (err) {
    console.error('[Thermometer]', err.message);
    res.status(500).json({ error: 'Failed to load thermometer data' });
  }
});

module.exports = router;
