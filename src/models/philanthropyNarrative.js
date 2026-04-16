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
    // Legacy-Giving-specific manual metrics (null for other departments).
    openEstates: { type: DataTypes.INTEGER, allowNull: true, field: 'open_estates' },
    newExpectancies: { type: DataTypes.INTEGER, allowNull: true, field: 'new_expectancies' },
    totalExpectancies: { type: DataTypes.INTEGER, allowNull: true, field: 'total_expectancies' },
  }, {
    tableName: 'philanthropy_narratives',
    timestamps: true,
    underscored: true, // maps createdAt/updatedAt → created_at/updated_at
    indexes: [
      { fields: ['tenant_id', 'department', 'fiscal_year'], unique: true },
    ],
  });
};
