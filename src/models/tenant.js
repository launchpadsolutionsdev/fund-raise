const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Tenant', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    slug: { type: DataTypes.STRING(100), unique: true, allowNull: false },
  }, {
    tableName: 'tenants',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: false,
  });
};
