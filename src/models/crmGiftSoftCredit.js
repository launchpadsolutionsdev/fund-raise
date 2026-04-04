const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrmGiftSoftCredit', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    giftId: { type: DataTypes.STRING(50), allowNull: false, field: 'gift_id' },

    softCreditAmount: { type: DataTypes.DECIMAL(14, 2), field: 'soft_credit_amount' },
    recipientFirstName: { type: DataTypes.STRING(255), field: 'recipient_first_name' },
    recipientId: { type: DataTypes.STRING(50), field: 'recipient_id' },
    recipientLastName: { type: DataTypes.STRING(255), field: 'recipient_last_name' },
    recipientName: { type: DataTypes.STRING(255), field: 'recipient_name' },
  }, {
    tableName: 'crm_gift_soft_credits',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id', 'gift_id', 'recipient_id'] },
      { fields: ['tenant_id', 'recipient_id'] },
      { fields: ['tenant_id', 'recipient_name'] },
    ],
  });
};
