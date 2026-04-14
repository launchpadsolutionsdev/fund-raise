'use strict';

/**
 * Create the writing_outputs table.
 *
 * Every successful generation from the Writing Assistant, Thank-You
 * Letters, Impact Stories, Meeting Prep, and Weekly Digest features
 * gets a row here. Backs history, saved library, ratings/feedback,
 * and per-feature usage analytics.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('writing_outputs', {
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
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      feature: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      params: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      prompt_version: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      generated_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      model: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      input_tokens: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      output_tokens: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      cache_read_tokens: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      cache_creation_tokens: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      duration_ms: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      rating: {
        type: Sequelize.STRING(16),
        allowNull: true,
      },
      feedback_note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      is_saved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      saved_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      is_hidden: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    await queryInterface.addIndex('writing_outputs', ['tenant_id', 'created_at']);
    await queryInterface.addIndex('writing_outputs', ['user_id', 'created_at']);
    await queryInterface.addIndex('writing_outputs', ['feature', 'created_at']);
    await queryInterface.addIndex('writing_outputs', ['rating']);
    await queryInterface.addIndex('writing_outputs', ['is_saved']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('writing_outputs');
  },
};
