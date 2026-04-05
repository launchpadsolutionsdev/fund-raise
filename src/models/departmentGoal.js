const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('DepartmentGoal', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    department: { type: DataTypes.STRING(20), allowNull: false, field: 'department' },
    fiscalYear: { type: DataTypes.INTEGER, allowNull: false, field: 'fiscal_year' },
    goalAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'goal_amount' },
  }, {
    tableName: 'department_goals',
    timestamps: true,
    indexes: [
      { fields: ['tenant_id', 'department', 'fiscal_year'], unique: true },
    ],
  });
};
