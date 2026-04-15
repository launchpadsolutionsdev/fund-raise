const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrmLybuntOutreachAction', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    constituentId: { type: DataTypes.STRING(255), allowNull: false, field: 'constituent_id' },
    actionType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'contacted',
      field: 'action_type',
      validate: {
        isIn: [['queued', 'contacted', 'excluded', 'reactivated', 'note']],
      },
    },
    channel: { type: DataTypes.STRING(50), field: 'channel' },
    actionDate: { type: DataTypes.DATEONLY, field: 'action_date' },
    excludedUntil: { type: DataTypes.DATEONLY, field: 'excluded_until' },
    notes: { type: DataTypes.TEXT, field: 'notes' },
    createdByUserId: { type: DataTypes.INTEGER, field: 'created_by_user_id' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  }, {
    tableName: 'crm_lybunt_outreach_actions',
    timestamps: true,
    indexes: [
      { fields: ['tenant_id', 'constituent_id'] },
      { fields: ['tenant_id', 'action_date'] },
      { fields: ['tenant_id', 'action_type'] },
    ],
  });
};
