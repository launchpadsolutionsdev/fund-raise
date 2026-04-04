const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrmGiftFundraiser', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    giftId: { type: DataTypes.STRING(50), allowNull: false, field: 'gift_id' },

    fundraiserName: { type: DataTypes.STRING(255), field: 'fundraiser_name' },
    fundraiserFirstName: { type: DataTypes.STRING(255), field: 'fundraiser_first_name' },
    fundraiserLastName: { type: DataTypes.STRING(255), field: 'fundraiser_last_name' },
    fundraiserAmount: { type: DataTypes.DECIMAL(14, 2), field: 'fundraiser_amount' },
  }, {
    tableName: 'crm_gift_fundraisers',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['tenant_id', 'gift_id', 'fundraiser_name'] },
      { fields: ['tenant_id', 'fundraiser_name'] },
      { fields: ['tenant_id', 'fundraiser_last_name'] },
    ],
  });
};
