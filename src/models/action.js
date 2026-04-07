const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Action = sequelize.define('Action', {
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
    assignedById: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'assigned_by_id',
    },
    assignedToId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'assigned_to_id',
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    constituentName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'constituent_name',
    },
    constituentId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'constituent_id',
    },
    systemRecordId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'system_record_id',
    },
    donorContext: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'donor_context',
    },
    status: {
      type: DataTypes.ENUM('open', 'pending', 'resolved'),
      defaultValue: 'open',
      allowNull: false,
    },
    priority: {
      type: DataTypes.ENUM('normal', 'high', 'urgent'),
      defaultValue: 'normal',
      allowNull: false,
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'resolved_at',
    },
    resolvedById: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'resolved_by_id',
    },
    lastViewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_viewed_at',
    },
  }, {
    tableName: 'actions',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['tenant_id', 'assigned_to_id', 'status'] },
      { fields: ['tenant_id', 'assigned_by_id', 'status'] },
    ],
  });

  return Action;
};
