const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('GiftTypeBreakdown', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false, field: 'snapshot_id' },
    department: { type: DataTypes.STRING(50), allowNull: false },
    giftType: { type: DataTypes.STRING(100), allowNull: false, field: 'gift_type' },
    amount: { type: DataTypes.INTEGER },
    pctOfGifts: { type: DataTypes.DECIMAL(8, 6), field: 'pct_of_gifts' },
  }, {
    tableName: 'gift_type_breakdowns',
    timestamps: false,
  });
};
