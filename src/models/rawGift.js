const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('RawGift', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false, field: 'snapshot_id' },
    department: { type: DataTypes.STRING(50), allowNull: false },
    primaryAddressee: { type: DataTypes.STRING(255), field: 'primary_addressee' },
    appealId: { type: DataTypes.STRING(255), field: 'appeal_id' },
    splitAmount: { type: DataTypes.DECIMAL(12, 2), field: 'split_amount' },
    fundDescription: { type: DataTypes.STRING(255), field: 'fund_description' },
    giftId: { type: DataTypes.INTEGER, field: 'gift_id' },
    giftType: { type: DataTypes.STRING(100), field: 'gift_type' },
    giftReference: { type: DataTypes.STRING(255), field: 'gift_reference' },
    giftDate: { type: DataTypes.DATEONLY, field: 'gift_date' },
    extraField: { type: DataTypes.STRING(255), field: 'extra_field' },
  }, {
    tableName: 'raw_gifts',
    timestamps: false,
  });
};
