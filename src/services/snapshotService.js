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
};
