const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('FundBreakdown', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false, field: 'snapshot_id' },
    department: { type: DataTypes.STRING(50), allowNull: false },
    category: { type: DataTypes.STRING(50), defaultValue: 'primary' },
    fundName: { type: DataTypes.STRING(255), allowNull: false, field: 'fund_name' },
    amount: { type: DataTypes.DECIMAL(12, 2) },
    pctOfTotal: { type: DataTypes.DECIMAL(12, 6), field: 'pct_of_total' },
    onetimeCount: { type: DataTypes.INTEGER, field: 'onetime_count' },
    recurringCount: { type: DataTypes.INTEGER, field: 'recurring_count' },
    onlineCount: { type: DataTypes.INTEGER, field: 'online_count' },
    mailedInCount: { type: DataTypes.INTEGER, field: 'mailed_in_count' },
    totalCount: { type: DataTypes.INTEGER, field: 'total_count' },
  }, {
    tableName: 'fund_breakdowns',
    timestamps: false,
  });
};
