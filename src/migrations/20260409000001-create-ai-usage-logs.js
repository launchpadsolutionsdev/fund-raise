'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_usage_logs', {
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
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      conversation_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      model: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      input_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      output_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      cache_read_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      cache_creation_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      tool_rounds: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      tools_used: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      duration_ms: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      success: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('ai_usage_logs', ['tenant_id', 'created_at']);
    await queryInterface.addIndex('ai_usage_logs', ['user_id', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_usage_logs');
  },
};
