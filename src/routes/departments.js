const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { getAvailableDates, getSnapshotForDate, getDepartmentData } = require('../services/snapshotService');

const DEPARTMENTS = {
  annual_giving: 'Annual Giving',
  direct_mail: 'Direct Mail',
  events: 'Events',
  major_gifts: 'Major Gifts',
  legacy_giving: 'Legacy Giving',
};

router.get('/:deptSlug', ensureAuth, async (req, res) => {
  const { deptSlug } = req.params;
  if (!DEPARTMENTS[deptSlug]) return res.status(404).render('error', { title: 'Not Found', message: 'Department not found.' });

  try {
    const tenantId = req.user.tenantId;
    const availableDates = await getAvailableDates(tenantId);
    const selectedDate = req.query.date || (availableDates[0] || null);

    const snapshot = selectedDate ? await getSnapshotForDate(tenantId, selectedDate) : null;
    const data = snapshot ? await getDepartmentData(snapshot, deptSlug) : null;

    res.render(`departments/${deptSlug}`, {
      title: DEPARTMENTS[deptSlug],
      departmentName: DEPARTMENTS[deptSlug],
      deptSlug,
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

module.exports = router;
