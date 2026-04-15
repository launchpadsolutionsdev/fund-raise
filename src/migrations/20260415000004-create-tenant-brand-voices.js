'use strict';

/**
 * Create tenant_brand_voices — one row per tenant, holding the admin's
 * description of their organisation's writing voice. Spliced into the
 * system prompt as a second cached block.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tenant_brand_voices', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      tenant_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      tone_description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      organization_values: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      preferred_terms: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      banned_phrases: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      signature_block: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      additional_guidance: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      updated_by_id: {
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

    // tenant_id already has a unique constraint from the column definition.
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_brand_voices');
  },
};
