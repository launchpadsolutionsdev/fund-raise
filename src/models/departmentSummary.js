const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('DepartmentSummary', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false, field: 'snapshot_id' },
    department: { type: DataTypes.STRING(50), allowNull: false },
    totalGifts: { type: DataTypes.INTEGER, field: 'total_gifts' },
    totalAmount: { type: DataTypes.DECIMAL(12, 2), field: 'total_amount' },
    goal: { type: DataTypes.DECIMAL(12, 2) },
    pctToGoal: { type: DataTypes.DECIMAL(8, 6), field: 'pct_to_goal' },
    // Legacy-specific
    avgGift: { type: DataTypes.DECIMAL(12, 2), field: 'avg_gift' },
    newExpectancies: { type: DataTypes.INTEGER, field: 'new_expectancies' },
    openEstates: { type: DataTypes.INTEGER, field: 'open_estates' },
    recordedExpectancies: { type: DataTypes.INTEGER, field: 'recorded_expectancies' },
    // Events-specific (Third Party)
    thirdPartyTotalGifts: { type: DataTypes.INTEGER, field: 'third_party_total_gifts' },
    thirdPartyTotalAmount: { type: DataTypes.DECIMAL(12, 2), field: 'third_party_total_amount' },
    thirdPartyGoal: { type: DataTypes.DECIMAL(12, 2), field: 'third_party_goal' },
    thirdPartyPctToGoal: { type: DataTypes.DECIMAL(8, 6), field: 'third_party_pct_to_goal' },
  }, {
    tableName: 'department_summaries',
    timestamps: false,
  });
};
