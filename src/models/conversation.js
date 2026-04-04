const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Conversation = sequelize.define('Conversation', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
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
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'New conversation',
    },
    messages: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    sharedWith: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: 'shared_with',
    },
    isRenxtSession: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_renxt_session',
    },
  }, {
    tableName: 'conversations',
    timestamps: true,
    underscored: true,
  });

  return Conversation;
};
