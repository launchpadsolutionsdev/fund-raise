'use strict';

/**
 * Log of LYBUNT/SYBUNT outreach actions: who was contacted or queued or
 * explicitly excluded, by which user, when, and with what notes. The new
 * LYBUNT dashboard reads this table to show per-donor outreach status
 * ("contacted 3 days ago") and to exclude recently-contacted donors from
 * the work queue when the user chooses.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('crm_lybunt_outreach_actions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tenant_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      constituent_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      action_type: {
        // 'queued'  — added to an outreach list
        // 'contacted' — a touch was made (email / phone / mail / visit)
        // 'excluded' — explicitly removed from the queue, optionally until
        // 'reactivated' — outside caller can mark the donor as reactivated
        // 'note' — free-form note
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'contacted',
      },
      channel: {
        // optional: 'email' | 'phone' | 'mail' | 'visit' | 'event' | 'other'
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      action_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_DATE'),
      },
      excluded_until: {
        // For 'excluded' actions: suppress this donor from the queue
        // until this date (e.g. "exclude for 90 days after a heavy touch").
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'created_at',
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'updated_at',
      },
    });

    await queryInterface.addIndex('crm_lybunt_outreach_actions',
      ['tenant_id', 'constituent_id'],
      { name: 'idx_lybunt_outreach_tenant_constituent' });
    await queryInterface.addIndex('crm_lybunt_outreach_actions',
      ['tenant_id', 'action_date'],
      { name: 'idx_lybunt_outreach_tenant_date' });
    await queryInterface.addIndex('crm_lybunt_outreach_actions',
      ['tenant_id', 'action_type'],
      { name: 'idx_lybunt_outreach_tenant_type' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('crm_lybunt_outreach_actions');
  },
};
