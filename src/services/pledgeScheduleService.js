/**
 * Pledge Schedule Service
 *
 * Reads and writes pledge_installments — the expected-payment schedule
 * that the Pledge Pipeline dashboard never had. This is purely additive:
 * nothing in the existing pipeline rollups (crmDashboardService.getPledgePipeline)
 * or materialised views touches this table.
 *
 * Responsibilities:
 *   - List upcoming / overdue / paid installments (read)
 *   - Generate an equal-installment schedule from an existing pledge
 *     commitment row in crm_gifts (write)
 *   - Mark an installment paid or waived (write)
 *   - KPI rollup for the schedule page
 *
 * Tenant isolation: every query is WHERE tenant_id = :tenantId AND the
 * table has RLS policies (see migration 20260415000006) as a defence in
 * depth.
 */
const { sequelize, PledgeInstallment } = require('../models');
const { QueryTypes, Op } = require('sequelize');
const { PLEDGE_COMMITMENT_SQL } = require('./pledgeClassifier');

const QUERY_OPTS = { type: QueryTypes.SELECT };

// Cadence → months-between-installments.
const CADENCE_MONTHS = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
  one_time: 0,
};

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Summary KPIs + list rollups for the pledge schedule dashboard.
 *
 *   - totals: scheduled/paid/overdue amounts and counts
 *   - upcoming: next 90 days of 'scheduled' or 'partial' installments
 *   - overdue: due_date < today AND status NOT IN ('paid','waived','written_off')
 *   - recent: last 60 days of installments marked 'paid' or 'partial'
 *   - byMonth: next-12-month forecast (sum of expected amounts per month)
 */
async function getPledgeSchedule(tenantId) {
  const [totals] = await sequelize.query(`
    SELECT
      COALESCE(SUM(expected_amount) FILTER (
        WHERE status IN ('scheduled','partial')
      ), 0)::float AS scheduled_amount,
      COUNT(*) FILTER (
        WHERE status IN ('scheduled','partial')
      )::int AS scheduled_count,
      COALESCE(SUM(paid_amount), 0)::float AS paid_amount_total,
      COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
      COALESCE(SUM(expected_amount - paid_amount) FILTER (
        WHERE due_date < CURRENT_DATE
          AND status NOT IN ('paid','waived','written_off')
      ), 0)::float AS overdue_amount,
      COUNT(*) FILTER (
        WHERE due_date < CURRENT_DATE
          AND status NOT IN ('paid','waived','written_off')
      )::int AS overdue_count,
      COALESCE(SUM(expected_amount) FILTER (
        WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND status IN ('scheduled','partial')
      ), 0)::float AS next_30_amount,
      COALESCE(SUM(expected_amount) FILTER (
        WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
          AND status IN ('scheduled','partial')
      ), 0)::float AS next_90_amount
    FROM pledge_installments
    WHERE tenant_id = :tenantId
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  const upcoming = await sequelize.query(`
    SELECT pi.id, pi.pledge_gift_id, pi.constituent_id, pi.due_date,
           pi.expected_amount::float AS expected_amount,
           pi.paid_amount::float AS paid_amount,
           pi.status, pi.installment_number, pi.total_installments, pi.cadence,
           g.first_name, g.last_name, g.fund_description
    FROM pledge_installments pi
    LEFT JOIN LATERAL (
      SELECT first_name, last_name, fund_description
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_id = pi.pledge_gift_id
      LIMIT 1
    ) g ON TRUE
    WHERE pi.tenant_id = :tenantId
      AND pi.status IN ('scheduled','partial')
      AND pi.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
    ORDER BY pi.due_date ASC
    LIMIT 200
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  const overdue = await sequelize.query(`
    SELECT pi.id, pi.pledge_gift_id, pi.constituent_id, pi.due_date,
           pi.expected_amount::float AS expected_amount,
           pi.paid_amount::float AS paid_amount,
           pi.status, pi.installment_number, pi.total_installments, pi.cadence,
           (CURRENT_DATE - pi.due_date)::int AS days_overdue,
           g.first_name, g.last_name, g.fund_description
    FROM pledge_installments pi
    LEFT JOIN LATERAL (
      SELECT first_name, last_name, fund_description
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_id = pi.pledge_gift_id
      LIMIT 1
    ) g ON TRUE
    WHERE pi.tenant_id = :tenantId
      AND pi.due_date < CURRENT_DATE
      AND pi.status NOT IN ('paid','waived','written_off')
    ORDER BY pi.due_date ASC
    LIMIT 200
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  const recent = await sequelize.query(`
    SELECT pi.id, pi.pledge_gift_id, pi.constituent_id, pi.due_date, pi.paid_date,
           pi.expected_amount::float AS expected_amount,
           pi.paid_amount::float AS paid_amount,
           pi.status, pi.paid_gift_id,
           g.first_name, g.last_name, g.fund_description
    FROM pledge_installments pi
    LEFT JOIN LATERAL (
      SELECT first_name, last_name, fund_description
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_id = pi.pledge_gift_id
      LIMIT 1
    ) g ON TRUE
    WHERE pi.tenant_id = :tenantId
      AND pi.status IN ('paid','partial')
      AND pi.paid_date >= CURRENT_DATE - INTERVAL '60 days'
    ORDER BY pi.paid_date DESC NULLS LAST
    LIMIT 100
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  const byMonth = await sequelize.query(`
    SELECT to_char(date_trunc('month', due_date), 'YYYY-MM') AS month,
           COALESCE(SUM(expected_amount), 0)::float AS expected,
           COALESCE(SUM(paid_amount), 0)::float AS paid,
           COUNT(*)::int AS installment_count
    FROM pledge_installments
    WHERE tenant_id = :tenantId
      AND due_date BETWEEN date_trunc('month', CURRENT_DATE)
                       AND date_trunc('month', CURRENT_DATE) + INTERVAL '12 months'
    GROUP BY 1
    ORDER BY 1 ASC
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  return {
    summary: totals || {},
    upcoming,
    overdue,
    recent,
    byMonth,
  };
}

/**
 * List installments for a single pledge commitment. Used by the
 * donor-detail and pledge-detail views to show the schedule for a
 * specific pledge.
 */
async function listInstallmentsForPledge(tenantId, pledgeGiftId) {
  return PledgeInstallment.findAll({
    where: { tenantId, pledgeGiftId },
    order: [['dueDate', 'ASC']],
  });
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Generate an equal-installment schedule from an existing pledge
 * commitment in crm_gifts. Skips silently if the commitment already has
 * installments recorded (safe to re-call).
 *
 * @param {object} opts
 *   tenantId           (int, required)
 *   pledgeGiftId       (string, required) — crm_gifts.gift_id of the commitment
 *   totalInstallments  (int, required, 1–120)
 *   cadence            (string, required) — 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'one_time'
 *   firstDueDate       (ISO date string, required) — YYYY-MM-DD
 *   amountPerInstallment (number, optional) — defaults to commitment/total
 */
async function generateScheduleFromPledge(opts) {
  const {
    tenantId, pledgeGiftId, totalInstallments, cadence, firstDueDate,
    amountPerInstallment: overrideAmount,
  } = opts;

  if (!tenantId) throw new Error('tenantId required');
  if (!pledgeGiftId) throw new Error('pledgeGiftId required');
  if (!Number.isInteger(totalInstallments) || totalInstallments < 1 || totalInstallments > 120) {
    throw new Error('totalInstallments must be an integer 1–120');
  }
  if (!CADENCE_MONTHS.hasOwnProperty(cadence)) {
    throw new Error(`cadence must be one of: ${Object.keys(CADENCE_MONTHS).join(', ')}`);
  }
  if (!firstDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) {
    throw new Error('firstDueDate must be YYYY-MM-DD');
  }

  // Load the commitment row to pull the amount + constituent_id.
  const [commitment] = await sequelize.query(`
    SELECT gift_id, gift_amount::float AS gift_amount, constituent_id, gift_type, gift_code
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_id = :pledgeGiftId
      AND gift_date IS NOT NULL
      ${PLEDGE_COMMITMENT_SQL}
    LIMIT 1
  `, { replacements: { tenantId, pledgeGiftId }, ...QUERY_OPTS });

  if (!commitment) {
    throw new Error(`No pledge commitment found for gift_id ${pledgeGiftId}`);
  }

  // Refuse to duplicate — if any installments exist for this commitment,
  // require explicit clear-first.
  const existing = await PledgeInstallment.count({
    where: { tenantId, pledgeGiftId },
  });
  if (existing > 0) {
    throw new Error(`Schedule already exists for pledge ${pledgeGiftId} (${existing} installments). Delete first to regenerate.`);
  }

  const commitmentAmount = Number(commitment.gift_amount || 0);
  const perInstallment = overrideAmount != null
    ? Number(overrideAmount)
    : Math.round((commitmentAmount / totalInstallments) * 100) / 100;

  if (!(perInstallment > 0)) {
    throw new Error('Computed per-installment amount is zero or negative');
  }

  const monthsStep = CADENCE_MONTHS[cadence];
  const rows = [];
  const [y0, m0, d0] = firstDueDate.split('-').map(Number);

  for (let i = 0; i < totalInstallments; i++) {
    // JS month is 0-based; Date handles month overflow correctly.
    const d = new Date(Date.UTC(y0, m0 - 1 + i * monthsStep, d0));
    const due = d.toISOString().slice(0, 10);

    // Last installment absorbs rounding remainder so the sum matches
    // the commitment amount exactly.
    let amount = perInstallment;
    if (overrideAmount == null && i === totalInstallments - 1) {
      const runningTotal = perInstallment * (totalInstallments - 1);
      amount = Math.round((commitmentAmount - runningTotal) * 100) / 100;
    }

    rows.push({
      tenantId,
      pledgeGiftId,
      constituentId: commitment.constituent_id || null,
      dueDate: due,
      expectedAmount: amount,
      installmentNumber: i + 1,
      totalInstallments,
      cadence,
      status: 'scheduled',
    });
  }

  const created = await PledgeInstallment.bulkCreate(rows, { validate: true });
  return created;
}

/**
 * Mark an installment as paid (fully or partially). Safe to call
 * repeatedly — writes the new paid_amount and derives the status.
 */
async function markInstallmentPaid(tenantId, installmentId, { paidAmount, paidDate, paidGiftId, notes }) {
  const row = await PledgeInstallment.findOne({
    where: { tenantId, id: installmentId },
  });
  if (!row) throw new Error('Installment not found');

  const amt = Number(paidAmount);
  if (!(amt > 0)) throw new Error('paidAmount must be > 0');
  if (!paidDate || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    throw new Error('paidDate must be YYYY-MM-DD');
  }

  const expected = Number(row.expectedAmount);
  const status = amt + 0.005 >= expected ? 'paid' : 'partial';

  await row.update({
    paidAmount: amt,
    paidDate,
    paidGiftId: paidGiftId || null,
    status,
    notes: notes != null ? notes : row.notes,
  });

  return row;
}

/**
 * Waive an installment (explicitly forgiven, will never be collected).
 * Distinct from 'written_off' which implies accounting treatment.
 */
async function waiveInstallment(tenantId, installmentId, notes) {
  const row = await PledgeInstallment.findOne({
    where: { tenantId, id: installmentId },
  });
  if (!row) throw new Error('Installment not found');
  await row.update({ status: 'waived', notes: notes || row.notes });
  return row;
}

/**
 * Delete the schedule for a pledge — used before regenerating with
 * different terms. Only installments with no recorded payment are
 * eligible; paid/partial installments are retained to preserve history.
 */
async function clearSchedule(tenantId, pledgeGiftId) {
  return PledgeInstallment.destroy({
    where: {
      tenantId,
      pledgeGiftId,
      status: { [Op.in]: ['scheduled', 'overdue'] },
      paidAmount: 0,
    },
  });
}

module.exports = {
  CADENCE_MONTHS,
  getPledgeSchedule,
  listInstallmentsForPledge,
  generateScheduleFromPledge,
  markInstallmentPaid,
  waiveInstallment,
  clearSchedule,
};
