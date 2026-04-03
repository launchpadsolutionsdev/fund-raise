const { Op } = require('sequelize');
const { sequelize } = require('../models');
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

async function getEnhancedDashboardData(snapshot) {
  const [
    largestGiftRow,
    donorCountRow,
    giftDistribution,
    topDonors,
    topAppeals,
  ] = await Promise.all([
    RawGift.findOne({
      where: { snapshotId: snapshot.id },
      order: [['splitAmount', 'DESC']],
      attributes: ['splitAmount', 'primaryAddressee', 'department', 'fundDescription'],
    }),
    RawGift.count({
      where: { snapshotId: snapshot.id },
      distinct: true,
      col: 'primaryAddressee',
    }),
    sequelize.query(`
      SELECT
        CASE
          WHEN "splitAmount" < 100 THEN '$0–$99'
          WHEN "splitAmount" < 500 THEN '$100–$499'
          WHEN "splitAmount" < 1000 THEN '$500–$999'
          WHEN "splitAmount" < 5000 THEN '$1K–$4,999'
          WHEN "splitAmount" < 10000 THEN '$5K–$9,999'
          WHEN "splitAmount" < 50000 THEN '$10K–$49,999'
          ELSE '$50K+'
        END AS bucket,
        CASE
          WHEN "splitAmount" < 100 THEN 1
          WHEN "splitAmount" < 500 THEN 2
          WHEN "splitAmount" < 1000 THEN 3
          WHEN "splitAmount" < 5000 THEN 4
          WHEN "splitAmount" < 10000 THEN 5
          WHEN "splitAmount" < 50000 THEN 6
          ELSE 7
        END AS bucket_order,
        COUNT(*)::int AS count,
        SUM("splitAmount")::float AS total
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId
      GROUP BY bucket, bucket_order
      ORDER BY bucket_order
    `, { replacements: { snapshotId: snapshot.id }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT "primaryAddressee", SUM("splitAmount")::float AS total, COUNT(*)::int AS gifts
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId AND "primaryAddressee" IS NOT NULL
      GROUP BY "primaryAddressee"
      ORDER BY total DESC
      LIMIT 25
    `, { replacements: { snapshotId: snapshot.id }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT "appealId", COUNT(*)::int AS gifts, SUM("splitAmount")::float AS total,
             AVG("splitAmount")::float AS avg_gift,
             COUNT(DISTINCT "primaryAddressee")::int AS donors
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId AND "appealId" IS NOT NULL AND "appealId" != ''
      GROUP BY "appealId"
      ORDER BY total DESC
      LIMIT 20
    `, { replacements: { snapshotId: snapshot.id }, type: sequelize.QueryTypes.SELECT }),
  ]);

  return {
    largestGift: largestGiftRow ? {
      amount: parseFloat(largestGiftRow.splitAmount) || 0,
      donor: largestGiftRow.primaryAddressee,
      department: largestGiftRow.department,
      fund: largestGiftRow.fundDescription,
    } : null,
    donorCount: donorCountRow || 0,
    giftDistribution,
    topDonors,
    topAppeals,
  };
}

async function getDepartmentEnhancedData(snapshot, department) {
  const [topDonors, giftDistribution, appealPerformance, channelMix] = await Promise.all([
    sequelize.query(`
      SELECT "primaryAddressee", SUM("splitAmount")::float AS total,
             COUNT(*)::int AS gifts, MAX("giftDate") AS last_gift
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId AND "department" = :department
        AND "primaryAddressee" IS NOT NULL
      GROUP BY "primaryAddressee"
      ORDER BY total DESC
      LIMIT 10
    `, { replacements: { snapshotId: snapshot.id, department }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT
        CASE
          WHEN "splitAmount" < 100 THEN '$0–$99'
          WHEN "splitAmount" < 500 THEN '$100–$499'
          WHEN "splitAmount" < 1000 THEN '$500–$999'
          WHEN "splitAmount" < 5000 THEN '$1K–$4,999'
          WHEN "splitAmount" < 10000 THEN '$5K–$9,999'
          WHEN "splitAmount" < 50000 THEN '$10K–$49,999'
          ELSE '$50K+'
        END AS bucket,
        CASE
          WHEN "splitAmount" < 100 THEN 1
          WHEN "splitAmount" < 500 THEN 2
          WHEN "splitAmount" < 1000 THEN 3
          WHEN "splitAmount" < 5000 THEN 4
          WHEN "splitAmount" < 10000 THEN 5
          WHEN "splitAmount" < 50000 THEN 6
          ELSE 7
        END AS bucket_order,
        COUNT(*)::int AS count,
        SUM("splitAmount")::float AS total
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId AND "department" = :department
      GROUP BY bucket, bucket_order
      ORDER BY bucket_order
    `, { replacements: { snapshotId: snapshot.id, department }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT "appealId", COUNT(*)::int AS gifts, SUM("splitAmount")::float AS total,
             AVG("splitAmount")::float AS avg_gift,
             COUNT(DISTINCT "primaryAddressee")::int AS donors
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId AND "department" = :department
        AND "appealId" IS NOT NULL AND "appealId" != ''
      GROUP BY "appealId"
      ORDER BY total DESC
      LIMIT 15
    `, { replacements: { snapshotId: snapshot.id, department }, type: sequelize.QueryTypes.SELECT }),
    FundBreakdown.findAll({
      where: { snapshotId: snapshot.id, department },
      attributes: ['fundName', 'amount', 'onetimeCount', 'recurringCount', 'onlineCount', 'mailedInCount', 'totalCount'],
    }),
  ]);

  // Compute channel mix totals for annual_giving and direct_mail
  let channelTotals = null;
  if (['annual_giving', 'direct_mail'].includes(department)) {
    let totalOnetime = 0, totalRecurring = 0, totalOnline = 0, totalMailed = 0, totalAll = 0;
    for (const f of channelMix) {
      totalOnetime += f.onetimeCount || 0;
      totalRecurring += f.recurringCount || 0;
      totalOnline += f.onlineCount || 0;
      totalMailed += f.mailedInCount || 0;
      totalAll += f.totalCount || 0;
    }
    channelTotals = {
      onetime: totalOnetime,
      recurring: totalRecurring,
      online: totalOnline,
      mailed: totalMailed,
      total: totalAll,
      recurringRate: totalAll ? (totalRecurring / totalAll * 100) : 0,
      onlineRate: totalAll ? (totalOnline / totalAll * 100) : 0,
    };
  }

  return { topDonors, giftDistribution, appealPerformance, channelTotals };
}

async function getCrossDepartmentData(snapshot) {
  const [crossDeptDonors, donorConcentration, fundRankings] = await Promise.all([
    sequelize.query(`
      SELECT "primaryAddressee", COUNT(DISTINCT "department")::int AS dept_count,
             array_agg(DISTINCT "department") AS departments,
             SUM("splitAmount")::float AS total, COUNT(*)::int AS gifts
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId AND "primaryAddressee" IS NOT NULL
      GROUP BY "primaryAddressee"
      HAVING COUNT(DISTINCT "department") > 1
      ORDER BY total DESC
      LIMIT 25
    `, { replacements: { snapshotId: snapshot.id }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      WITH ranked AS (
        SELECT "primaryAddressee", SUM("splitAmount")::float AS total
        FROM "RawGifts"
        WHERE "snapshotId" = :snapshotId AND "primaryAddressee" IS NOT NULL
        GROUP BY "primaryAddressee"
        ORDER BY total DESC
      ),
      totals AS (
        SELECT SUM(total) AS grand_total, COUNT(*) AS donor_count FROM ranked
      )
      SELECT
        (SELECT SUM(r.total) FROM (SELECT total FROM ranked LIMIT GREATEST(1, (SELECT donor_count FROM totals) * 10 / 100)) r) /
          NULLIF((SELECT grand_total FROM totals), 0) * 100 AS top10_pct,
        (SELECT SUM(r.total) FROM (SELECT total FROM ranked LIMIT GREATEST(1, (SELECT donor_count FROM totals) * 20 / 100)) r) /
          NULLIF((SELECT grand_total FROM totals), 0) * 100 AS top20_pct,
        (SELECT SUM(r.total) FROM (SELECT total FROM ranked LIMIT GREATEST(1, (SELECT donor_count FROM totals) * 50 / 100)) r) /
          NULLIF((SELECT grand_total FROM totals), 0) * 100 AS top50_pct,
        (SELECT donor_count FROM totals) AS total_donors
    `, { replacements: { snapshotId: snapshot.id }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT "fundDescription", "department", SUM("splitAmount")::float AS total,
             COUNT(*)::int AS gifts, AVG("splitAmount")::float AS avg_gift
      FROM "RawGifts"
      WHERE "snapshotId" = :snapshotId AND "fundDescription" IS NOT NULL
      GROUP BY "fundDescription", "department"
      ORDER BY total DESC
      LIMIT 20
    `, { replacements: { snapshotId: snapshot.id }, type: sequelize.QueryTypes.SELECT }),
  ]);

  return {
    crossDeptDonors,
    donorConcentration: donorConcentration[0] || { top10_pct: 0, top20_pct: 0, top50_pct: 0, total_donors: 0 },
    fundRankings,
  };
}

async function getTrendsEnhanced(tenantId) {
  const snapshots = await Snapshot.findAll({
    where: { tenantId },
    order: [['snapshotDate', 'ASC']],
  });

  const data = [];
  for (const snap of snapshots) {
    const summaries = await DepartmentSummary.findAll({ where: { snapshotId: snap.id } });
    let totalRaised = 0, combinedGoal = 0, totalGifts = 0;
    const departments = {};
    for (const s of summaries) {
      let deptAmount = parseFloat(s.totalAmount) || 0;
      let deptGifts = s.totalGifts || 0;
      let deptGoal = parseFloat(s.goal) || 0;
      if (s.department === 'events') {
        deptAmount += parseFloat(s.thirdPartyTotalAmount) || 0;
        deptGifts += s.thirdPartyTotalGifts || 0;
        deptGoal += parseFloat(s.thirdPartyGoal) || 0;
      }
      totalRaised += deptAmount;
      totalGifts += deptGifts;
      combinedGoal += deptGoal;
      departments[s.department] = { totalAmount: deptAmount, totalGifts: deptGifts };
    }
    data.push({
      date: snap.snapshotDate,
      totalRaised,
      combinedGoal,
      totalGifts,
      departments,
    });
  }
  return data;
}

async function getSnapshotComparison(tenantId, date1, date2) {
  const [snap1, snap2] = await Promise.all([
    Snapshot.findOne({ where: { tenantId, snapshotDate: date1 } }),
    Snapshot.findOne({ where: { tenantId, snapshotDate: date2 } }),
  ]);
  if (!snap1 || !snap2) return null;

  const [summaries1, summaries2] = await Promise.all([
    DepartmentSummary.findAll({ where: { snapshotId: snap1.id } }),
    DepartmentSummary.findAll({ where: { snapshotId: snap2.id } }),
  ]);

  function rollUp(summaries) {
    let totalRaised = 0, totalGifts = 0, combinedGoal = 0;
    const departments = {};
    for (const s of summaries) {
      let amt = parseFloat(s.totalAmount) || 0;
      let gifts = s.totalGifts || 0;
      let goal = parseFloat(s.goal) || 0;
      if (s.department === 'events') {
        amt += parseFloat(s.thirdPartyTotalAmount) || 0;
        gifts += s.thirdPartyTotalGifts || 0;
        goal += parseFloat(s.thirdPartyGoal) || 0;
      }
      totalRaised += amt;
      totalGifts += gifts;
      combinedGoal += goal;
      departments[s.department] = { totalAmount: amt, totalGifts: gifts, goal, pctToGoal: goal ? (amt / goal * 100) : 0 };
    }
    return { totalRaised, totalGifts, combinedGoal, overallPct: combinedGoal ? (totalRaised / combinedGoal * 100) : 0, departments };
  }

  const period1 = rollUp(summaries1);
  const period2 = rollUp(summaries2);

  // Compute deltas
  const delta = {
    totalRaised: period2.totalRaised - period1.totalRaised,
    totalGifts: period2.totalGifts - period1.totalGifts,
    overallPct: period2.overallPct - period1.overallPct,
    departments: {},
  };
  const allDepts = new Set([...Object.keys(period1.departments), ...Object.keys(period2.departments)]);
  for (const d of allDepts) {
    const p1 = period1.departments[d] || { totalAmount: 0, totalGifts: 0, pctToGoal: 0 };
    const p2 = period2.departments[d] || { totalAmount: 0, totalGifts: 0, pctToGoal: 0 };
    delta.departments[d] = {
      totalAmount: p2.totalAmount - p1.totalAmount,
      totalGifts: p2.totalGifts - p1.totalGifts,
      pctToGoal: p2.pctToGoal - p1.pctToGoal,
    };
  }

  return { date1, date2, period1, period2, delta };
}

async function getGiftSeasonality(snapshot) {
  const rows = await sequelize.query(`
    SELECT
      EXTRACT(MONTH FROM "giftDate"::date)::int AS month,
      COUNT(*)::int AS gifts,
      SUM("splitAmount")::float AS total,
      AVG("splitAmount")::float AS avg_gift
    FROM "RawGifts"
    WHERE "snapshotId" = :snapshotId
      AND "giftDate" IS NOT NULL AND "giftDate" != ''
    GROUP BY month
    ORDER BY month
  `, { replacements: { snapshotId: snapshot.id }, type: sequelize.QueryTypes.SELECT });
  return rows;
}

async function getProjection(tenantId) {
  const trends = await getTrendsEnhanced(tenantId);
  if (trends.length < 1) return null;

  const latest = trends[trends.length - 1];
  const goal = latest.combinedGoal;
  const raised = latest.totalRaised;

  // Estimate fiscal year progress based on snapshot dates
  // Use first and last snapshot to calculate velocity
  if (trends.length >= 2) {
    const firstDate = new Date(trends[0].date);
    const lastDate = new Date(latest.date);
    const daysBetween = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24));
    const growthTotal = latest.totalRaised - trends[0].totalRaised;
    const dailyRate = growthTotal / daysBetween;

    // Project to fiscal year end (assume June 30)
    const fyEnd = new Date(lastDate.getFullYear(), 5, 30); // June 30
    if (fyEnd <= lastDate) fyEnd.setFullYear(fyEnd.getFullYear() + 1);
    const daysRemaining = Math.max(0, (fyEnd - lastDate) / (1000 * 60 * 60 * 24));

    const projected = raised + (dailyRate * daysRemaining);
    const requiredDaily = daysRemaining > 0 ? Math.max(0, (goal - raised) / daysRemaining) : 0;

    return {
      currentTotal: raised,
      goal,
      gapToGoal: Math.max(0, goal - raised),
      dailyRate,
      daysRemaining: Math.round(daysRemaining),
      fyEndDate: fyEnd.toISOString().split('T')[0],
      projectedTotal: projected,
      projectedPct: goal ? (projected / goal * 100) : 0,
      requiredDaily,
      onTrack: projected >= goal,
      snapshotCount: trends.length,
    };
  }

  return {
    currentTotal: raised,
    goal,
    gapToGoal: Math.max(0, goal - raised),
    dailyRate: 0,
    daysRemaining: 0,
    fyEndDate: null,
    projectedTotal: raised,
    projectedPct: goal ? (raised / goal * 100) : 0,
    requiredDaily: 0,
    onTrack: raised >= goal,
    snapshotCount: trends.length,
  };
}

async function getOperationalMetrics(tenantId) {
  const [snapshots, totalGifts] = await Promise.all([
    Snapshot.findAll({
      where: { tenantId },
      order: [['snapshotDate', 'DESC']],
      include: [{ model: require('../models').User, as: 'uploader', attributes: ['name', 'email'] }],
    }),
    RawGift.count({
      include: [{ model: Snapshot, where: { tenantId }, attributes: [] }],
    }),
  ]);

  const latestSnap = snapshots[0] || null;
  const daysSinceUpload = latestSnap
    ? Math.round((Date.now() - new Date(latestSnap.uploadedAt || latestSnap.createdAt)) / (1000 * 60 * 60 * 24))
    : null;

  // Department coverage for latest snapshot
  let deptCoverage = [];
  if (latestSnap) {
    const depts = await DepartmentSummary.findAll({
      where: { snapshotId: latestSnap.id },
      attributes: ['department'],
    });
    deptCoverage = depts.map(d => d.department);
  }

  return {
    totalSnapshots: snapshots.length,
    daysSinceUpload,
    totalRawGifts: totalGifts,
    deptCoverage,
    uploadHistory: snapshots.slice(0, 10).map(s => ({
      date: s.snapshotDate,
      uploadedAt: s.uploadedAt || s.createdAt,
      uploadedBy: s.uploader ? (s.uploader.name || s.uploader.email) : 'Unknown',
      notes: s.notes,
    })),
  };
}

module.exports = {
  getAvailableDates,
  getSnapshotForDate,
  getDashboardData,
  getDepartmentData,
  saveDepartmentData,
  getEnhancedDashboardData,
  getDepartmentEnhancedData,
  getCrossDepartmentData,
  getTrendsEnhanced,
  getSnapshotComparison,
  getGiftSeasonality,
  getProjection,
  getOperationalMetrics,
};
