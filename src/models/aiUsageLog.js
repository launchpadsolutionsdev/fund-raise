const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AiUsageLog = sequelize.define('AiUsageLog', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'tenant_id',
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id',
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'conversation_id',
    },
    model: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    inputTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'input_tokens',
    },
    outputTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'output_tokens',
    },
    cacheReadTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'cache_read_tokens',
    },
    cacheCreationTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'cache_creation_tokens',
    },
    toolRounds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'tool_rounds',
    },
    toolsUsed: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: 'tools_used',
    },
    durationMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'duration_ms',
    },
    success: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'error_message',
    },
  }, {
    tableName: 'ai_usage_logs',
    timestamps: true,
    updatedAt: false, // Only createdAt needed
    underscored: true,
    indexes: [
      { fields: ['tenant_id', 'created_at'] },
      { fields: ['user_id', 'created_at'] },
    ],
  });

  return AiUsageLog;
};
