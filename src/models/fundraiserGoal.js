const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('FundraiserGoal', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    fundraiserName: { type: DataTypes.STRING(500), allowNull: false, field: 'fundraiser_name' },
    fiscalYear: { type: DataTypes.INTEGER, allowNull: false, field: 'fiscal_year' },
    goalAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'goal_amount' },
  }, {
    tableName: 'fundraiser_goals',
    timestamps: true,
    indexes: [
      { fields: ['tenant_id', 'fundraiser_name', 'fiscal_year'], unique: true },
    ],
  });
};
