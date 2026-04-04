const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const QuickNote = sequelize.define('QuickNote', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id',
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'tenant_id',
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    },
    color: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'yellow',
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'sort_order',
    },
  }, {
    tableName: 'quick_notes',
    timestamps: true,
    underscored: true,
  });

  return QuickNote;
};
