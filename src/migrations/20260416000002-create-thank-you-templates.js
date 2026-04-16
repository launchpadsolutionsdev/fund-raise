'use strict';

/**
 * Create the thank_you_templates table.
 *
 * Canned thank-you letter templates with {{merge_field}} placeholders,
 * scoped to a specific fund / campaign / appeal, or marked as the tenant
 * default. Distinct from writing_templates (which stores AI-prompt
 * parameter sets used by the LLM-driven writing features).
 *
 * A gift or donor view picks the most specific matching template:
 *   fund match → campaign match → appeal match → default
 *
 * Why the per-scope columns are nullable STRINGs (not FKs):
 *   - crm_gifts.fund_id / campaign_id / appeal_id are tenant-scoped
 *     varchars rather than integer PKs (they come from RE NXT exports),
 *     so a FK would be meaningless.
 *   - Matches the approach already in crm_gift_* sibling tables.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('thank_you_templates', {
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
      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      subject: { type: Sequelize.STRING(200), allowNull: true },
      body: { type: Sequelize.TEXT, allowNull: false },

      // 'default' | 'fund' | 'campaign' | 'appeal'
      scope_type: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'default',
      },
      fund_id:     { type: Sequelize.STRING(255), allowNull: true },
      campaign_id: { type: Sequelize.STRING(255), allowNull: true },
      appeal_id:   { type: Sequelize.STRING(255), allowNull: true },
      // Human-readable cache so the admin list doesn't join crm_gifts.
      scope_label: { type: Sequelize.STRING(500), allowNull: true },

      is_archived: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
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

    await queryInterface.addIndex('thank_you_templates', ['tenant_id', 'is_archived']);
    await queryInterface.addIndex('thank_you_templates', ['tenant_id', 'scope_type']);
    await queryInterface.addIndex('thank_you_templates', ['tenant_id', 'fund_id']);
    await queryInterface.addIndex('thank_you_templates', ['tenant_id', 'campaign_id']);
    await queryInterface.addIndex('thank_you_templates', ['tenant_id', 'appeal_id']);

    // Row-Level Security — same pattern as every other tenant-scoped table.
    await queryInterface.sequelize.query(`ALTER TABLE thank_you_templates ENABLE ROW LEVEL SECURITY`);
    await queryInterface.sequelize.query(`ALTER TABLE thank_you_templates FORCE ROW LEVEL SECURITY`);
    await queryInterface.sequelize.query(`
      CREATE POLICY tenant_isolation_thank_you_templates ON thank_you_templates
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
    `);
    await queryInterface.sequelize.query(`
      CREATE POLICY bypass_when_no_tenant_thank_you_templates ON thank_you_templates
        USING (NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL)
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP POLICY IF EXISTS tenant_isolation_thank_you_templates ON thank_you_templates`);
    await queryInterface.sequelize.query(`DROP POLICY IF EXISTS bypass_when_no_tenant_thank_you_templates ON thank_you_templates`);
    await queryInterface.dropTable('thank_you_templates');
  },
};
