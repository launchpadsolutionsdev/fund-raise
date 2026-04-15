'use strict';

/**
 * Create the pledge_installments table.
 *
 * Pledges live in crm_gifts (gift_type='Pledge' etc.), but there's no
 * record of WHEN each promised dollar is expected to arrive. Without
 * that, the Pledge Pipeline dashboard can only surface stale/at-risk
 * heuristics — it can't answer "what's due this month?" or "which
 * installments are overdue?".
 *
 * This table stores an expected schedule: one row per installment, with
 * a due date, an expected amount, and the payment (if any) that
 * fulfilled it.
 *
 * Design notes:
 *   - NOT a FK to crm_gifts. The commitment is addressed by
 *     (tenant_id, pledge_gift_id) — the same addressing convention used
 *     by crm_gift_soft_credits, crm_gift_matches, crm_gift_fundraisers
 *     (see src/models/index.js associations, constraints: false).
 *   - constituent_id is denormalised so upcoming/overdue queries don't
 *     need to join crm_gifts.
 *   - This table is purely ADDITIVE. Existing dashboards read only from
 *     crm_gifts and are unchanged.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pledge_installments', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      tenant_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },

      // The pledge commitment this installment belongs to. References
      // crm_gifts.gift_id (tenant-scoped — no FK, matches sibling tables).
      pledge_gift_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      // Denormalised from the parent commitment for fast donor queries.
      constituent_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },

      // Expected schedule
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      expected_amount: {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: false,
      },
      installment_number: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      total_installments: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      cadence: {
        // 'monthly', 'quarterly', 'semiannual', 'annual', 'one_time', 'custom'
        type: Sequelize.STRING(20),
        allowNull: true,
      },

      // Actual fulfilment (populated when a payment is applied)
      paid_amount: {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      paid_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      // Optional link to the crm_gifts.gift_id of the payment row that
      // satisfied this installment. Nullable so we can pre-schedule
      // without having a payment yet.
      paid_gift_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },

      // 'scheduled' | 'partial' | 'paid' | 'overdue' | 'waived' | 'written_off'
      // 'overdue' is computed at read time; stored here only when an admin
      // has explicitly marked it so.
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'scheduled',
      },

      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('pledge_installments', ['tenant_id', 'due_date']);
    await queryInterface.addIndex('pledge_installments', ['tenant_id', 'pledge_gift_id']);
    await queryInterface.addIndex('pledge_installments', ['tenant_id', 'constituent_id']);
    await queryInterface.addIndex('pledge_installments', ['tenant_id', 'status', 'due_date']);

    // Row-Level Security — same policies applied in baseline 20260407000001
    // for every tenant-scoped table.
    await queryInterface.sequelize.query(`ALTER TABLE pledge_installments ENABLE ROW LEVEL SECURITY`);
    await queryInterface.sequelize.query(`ALTER TABLE pledge_installments FORCE ROW LEVEL SECURITY`);
    await queryInterface.sequelize.query(`
      CREATE POLICY tenant_isolation_pledge_installments ON pledge_installments
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
    `);
    await queryInterface.sequelize.query(`
      CREATE POLICY bypass_when_no_tenant_pledge_installments ON pledge_installments
        USING (NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL)
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP POLICY IF EXISTS tenant_isolation_pledge_installments ON pledge_installments`);
    await queryInterface.sequelize.query(`DROP POLICY IF EXISTS bypass_when_no_tenant_pledge_installments ON pledge_installments`);
    await queryInterface.dropTable('pledge_installments');
  },
};
