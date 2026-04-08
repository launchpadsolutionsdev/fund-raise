const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true, // null for system-triggered events
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'e.g. crm_import, delete_post, role_change, blackbaud_disconnect, upload_snapshot',
    },
    category: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'general',
      comment: 'e.g. data, security, team, admin',
    },
    targetType: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'e.g. CrmImport, Post, User',
    },
    targetId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Extra context like filename, old/new role, record count',
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
  }, {
    tableName: 'audit_logs',
    timestamps: true,
    updatedAt: false, // Audit logs are append-only
    indexes: [
      { fields: ['tenantId', 'createdAt'] },
      { fields: ['tenantId', 'action'] },
      { fields: ['userId'] },
    ],
  });

  return AuditLog;
};
