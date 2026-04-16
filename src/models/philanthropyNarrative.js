const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('PhilanthropyNarrative', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    department: { type: DataTypes.STRING(40), allowNull: false, field: 'department' },
    fiscalYear: { type: DataTypes.INTEGER, allowNull: false, field: 'fiscal_year' },
    highlights: { type: DataTypes.TEXT, allowNull: true, field: 'highlights' },
    priorities: { type: DataTypes.TEXT, allowNull: true, field: 'priorities' },
    commentary: { type: DataTypes.TEXT, allowNull: true, field: 'commentary' },
  }, {
    tableName: 'philanthropy_narratives',
    timestamps: true,
    indexes: [
      { fields: ['tenant_id', 'department', 'fiscal_year'], unique: true },
    ],
  });
};
