const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { getAvailableDates, getSnapshotForDate, getDashboardData } = require('../services/snapshotService');

router.get('/dashboard', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const availableDates = await getAvailableDates(tenantId);
    let selectedDate = req.query.date || (availableDates[0] || null);

    const snapshot = selectedDate ? await getSnapshotForDate(tenantId, selectedDate) : null;
    const data = snapshot ? await getDashboardData(snapshot) : null;

    res.render('dashboard/main', {
      title: 'Master Dashboard',
      snapshot,
      data,
      availableDates,
      selectedDate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  }
});

router.get('/trends', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const availableDates = await getAvailableDates(tenantId);
    const selectedDate = req.query.date || (availableDates[0] || null);

    res.render('dashboard/trends', {
      title: 'Trends & Forecasting',
      availableDates,
      selectedDate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  }
});

router.get('/analytics', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const availableDates = await getAvailableDates(tenantId);
    const selectedDate = req.query.date || (availableDates[0] || null);

    res.render('dashboard/analytics', {
      title: 'Cross-Department Analytics',
      availableDates,
      selectedDate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  }
});

module.exports = router;
