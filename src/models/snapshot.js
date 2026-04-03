const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Snapshot', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, field: 'tenant_id' },
    snapshotDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'snapshot_date' },
    uploadedBy: { type: DataTypes.INTEGER, field: 'uploaded_by' },
    uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'uploaded_at' },
    notes: { type: DataTypes.TEXT },
  }, {
    tableName: 'snapshots',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['tenant_id', 'snapshot_date'] },
    ],
  });
};
