const {
  Snapshot, DepartmentSummary, GiftTypeBreakdown,
  SourceBreakdown, FundBreakdown, RawGift,
} = require('../models');

async function getAvailableDates(tenantId) {
  const snapshots = await Snapshot.findAll({
    where: { tenantId },
    order: [['snapshotDate', 'DESC']],
    attributes: ['snapshotDate'],
  });
  return snapshots.map(s => s.snapshotDate);
}

async function getSnapshotForDate(tenantId, date) {
  return Snapshot.findOne({ where: { tenantId, snapshotDate: date } });
}

async function getDashboardData(snapshot) {
  const summaries = await DepartmentSummary.findAll({ where: { snapshotId: snapshot.id } });

  let totalRaised = 0;
  let totalGifts = 0;
  let combinedGoal = 0;
  const departments = {};

  for (const s of summaries) {
    let deptAmount = parseFloat(s.totalAmount) || 0;
    let deptGifts = s.totalGifts || 0;
    let deptGoal = parseFloat(s.goal) || 0;

    totalRaised += deptAmount;
    totalGifts += deptGifts;
    combinedGoal += deptGoal;

    if (s.department === 'events') {
      const tpAmount = parseFloat(s.thirdPartyTotalAmount) || 0;
      const tpGifts = s.thirdPartyTotalGifts || 0;
      const tpGoal = parseFloat(s.thirdPartyGoal) || 0;
      totalRaised += tpAmount;
      totalGifts += tpGifts;
      combinedGoal += tpGoal;
      deptAmount += tpAmount;
      deptGifts += tpGifts;
      deptGoal += tpGoal;
    }

    departments[s.department] = {
      totalAmount: deptAmount,
      totalGifts: deptGifts,
      goal: deptGoal,
      pctToGoal: deptGoal ? (deptAmount / deptGoal * 100) : 0,
    };
  }

  return {
    totalRaised,
    totalGifts,
    combinedGoal,
    overallPct: combinedGoal ? (totalRaised / combinedGoal * 100) : 0,
    departments,
  };
}

async function getDepartmentData(snapshot, department) {
  const [summary, giftTypes, sources, funds, rawCount] = await Promise.all([
    DepartmentSummary.findOne({ where: { snapshotId: snapshot.id, department } }),
    GiftTypeBreakdown.findAll({ where: { snapshotId: snapshot.id, department } }),
    SourceBreakdown.findAll({ where: { snapshotId: snapshot.id, department } }),
    FundBreakdown.findAll({ where: { snapshotId: snapshot.id, department } }),
    RawGift.count({ where: { snapshotId: snapshot.id, department } }),
  ]);

  return { summary, giftTypes, sources, funds, rawCount };
}

async function saveDepartmentData(snapshot, department, parsed) {
  const s = parsed.summary;

  await DepartmentSummary.create({
    snapshotId: snapshot.id,
    department,
    totalGifts: s.totalGifts,
    totalAmount: s.totalAmount,
    goal: s.goal,
    pctToGoal: s.pctToGoal,
    avgGift: s.avgGift,
    newExpectancies: s.newExpectancies,
    openEstates: s.openEstates,
    recordedExpectancies: s.recordedExpectancies,
    thirdPartyTotalGifts: s.thirdPartyTotalGifts,
    thirdPartyTotalAmount: s.thirdPartyTotalAmount,
    thirdPartyGoal: s.thirdPartyGoal,
    thirdPartyPctToGoal: s.thirdPartyPctToGoal,
  });

  if (parsed.giftTypes.length) {
    await GiftTypeBreakdown.bulkCreate(
      parsed.giftTypes.map(gt => ({
        snapshotId: snapshot.id,
        department,
        giftType: gt.giftType,
        amount: gt.amount,
        pctOfGifts: gt.pctOfGifts,
      }))
    );
  }

  if (parsed.sources.length) {
    await SourceBreakdown.bulkCreate(
      parsed.sources.map(src => ({
        snapshotId: snapshot.id,
        department,
        source: src.source,
        amount: src.amount,
        pctOfGifts: src.pctOfGifts,
      }))
    );
  }

  if (parsed.funds.length) {
    await FundBreakdown.bulkCreate(
      parsed.funds.map(f => ({
        snapshotId: snapshot.id,
        department,
        fundName: f.fundName,
        category: f.category || 'primary',
        amount: f.amount,
        pctOfTotal: f.pctOfTotal,
        onetimeCount: f.onetimeCount,
        recurringCount: f.recurringCount,
        onlineCount: f.onlineCount,
        mailedInCount: f.mailedInCount,
        totalCount: f.totalCount,
      }))
    );
  }

  if (parsed.rawGifts.length) {
    await RawGift.bulkCreate(
      parsed.rawGifts.map(g => ({
        snapshotId: snapshot.id,
        department,
        primaryAddressee: g.primaryAddressee,
        appealId: g.appealId,
        splitAmount: g.splitAmount,
        fundDescription: g.fundDescription,
        giftId: g.giftId,
        giftType: g.giftType,
        giftReference: g.giftReference,
        giftDate: g.giftDate,
        extraField: g.extraField,
      }))
    );
  }
}

module.exports = {
  getAvailableDates,
  getSnapshotForDate,
  getDashboardData,
  getDepartmentData,
  saveDepartmentData,
};
