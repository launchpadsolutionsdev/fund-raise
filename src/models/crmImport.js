const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrmImport', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    uploadedBy: { type: DataTypes.INTEGER, field: 'uploaded_by' },
    uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'uploaded_at' },
    fileName: { type: DataTypes.STRING(255), field: 'file_name' },
    fileSize: { type: DataTypes.INTEGER, field: 'file_size' },
    status: {
      type: DataTypes.ENUM('processing', 'completed', 'failed'),
      defaultValue: 'processing',
    },
    totalRows: { type: DataTypes.INTEGER, field: 'total_rows' },
    giftsUpserted: { type: DataTypes.INTEGER, defaultValue: 0, field: 'gifts_upserted' },
    fundraisersUpserted: { type: DataTypes.INTEGER, defaultValue: 0, field: 'fundraisers_upserted' },
    softCreditsUpserted: { type: DataTypes.INTEGER, defaultValue: 0, field: 'soft_credits_upserted' },
    matchesUpserted: { type: DataTypes.INTEGER, defaultValue: 0, field: 'matches_upserted' },
    errorMessage: { type: DataTypes.TEXT, field: 'error_message' },
    completedAt: { type: DataTypes.DATE, field: 'completed_at' },
    columnMapping: { type: DataTypes.JSONB, field: 'column_mapping' },
  }, {
    tableName: 'crm_imports',
    timestamps: false,
  });
};
