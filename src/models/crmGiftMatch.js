const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrmGiftMatch', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    giftId: { type: DataTypes.STRING(50), allowNull: false, field: 'gift_id' },

    matchGiftId: { type: DataTypes.STRING(50), field: 'match_gift_id' },
    matchGiftCode: { type: DataTypes.STRING(100), field: 'match_gift_code' },
    matchGiftDate: { type: DataTypes.DATEONLY, field: 'match_gift_date' },
    matchReceiptAmount: { type: DataTypes.DECIMAL(14, 2), field: 'match_receipt_amount' },
    matchReceiptDate: { type: DataTypes.DATEONLY, field: 'match_receipt_date' },
    matchAcknowledge: { type: DataTypes.STRING(100), field: 'match_acknowledge' },
    matchAcknowledgeDate: { type: DataTypes.DATEONLY, field: 'match_acknowledge_date' },
    matchConstituentCode: { type: DataTypes.STRING(255), field: 'match_constituent_code' },
    matchIsAnonymous: { type: DataTypes.BOOLEAN, field: 'match_is_anonymous' },
    matchAddedBy: { type: DataTypes.STRING(255), field: 'match_added_by' },
    matchDateAdded: { type: DataTypes.DATEONLY, field: 'match_date_added' },
    matchDateLastChanged: { type: DataTypes.DATEONLY, field: 'match_date_last_changed' },
  }, {
    tableName: 'crm_gift_matches',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id', 'gift_id', 'match_gift_id'] },
      { fields: ['tenant_id', 'match_gift_id'] },
    ],
  });
};
