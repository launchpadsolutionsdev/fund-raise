'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add RE NXT sync columns to the actions table
    await queryInterface.addColumn('actions', 're_nxt_action_id', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('actions', 're_nxt_sync_status', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: 'pending',
    });
    await queryInterface.addColumn('actions', 're_nxt_sync_error', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('actions', 're_nxt_last_synced_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // Create the RE NXT config cache table
    await queryInterface.createTable('re_nxt_config_cache', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tenant_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      config_type: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      config_values: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      fetched_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    // Unique constraint: one row per org per config type
    await queryInterface.addConstraint('re_nxt_config_cache', {
      fields: ['tenant_id', 'config_type'],
      type: 'unique',
      name: 'uq_re_nxt_config_cache_tenant_type',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('actions', 're_nxt_action_id');
    await queryInterface.removeColumn('actions', 're_nxt_sync_status');
    await queryInterface.removeColumn('actions', 're_nxt_sync_error');
    await queryInterface.removeColumn('actions', 're_nxt_last_synced_at');
    await queryInterface.dropTable('re_nxt_config_cache');
  },
};
