const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('SourceBreakdown', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false, field: 'snapshot_id' },
    department: { type: DataTypes.STRING(50), allowNull: false },
    source: { type: DataTypes.STRING(100), allowNull: false },
    amount: { type: DataTypes.INTEGER },
    pctOfGifts: { type: DataTypes.DECIMAL(12, 6), field: 'pct_of_gifts' },
  }, {
    tableName: 'source_breakdowns',
    timestamps: false,
  });
};
