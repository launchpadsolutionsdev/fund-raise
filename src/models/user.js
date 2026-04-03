const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, field: 'tenant_id' },
    email: { type: DataTypes.STRING(255), unique: true, allowNull: false },
    name: { type: DataTypes.STRING(255) },
    googleId: { type: DataTypes.STRING(255), unique: true, field: 'google_id' },
    avatarUrl: { type: DataTypes.TEXT, field: 'avatar_url' },
    role: { type: DataTypes.STRING(50), defaultValue: 'viewer' },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'is_active' },
    lastLogin: { type: DataTypes.DATE, field: 'last_login' },
  }, {
    tableName: 'users',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: false,
  });

  User.prototype.isAdmin = function () { return this.role === 'admin'; };
  User.prototype.canUpload = function () { return ['admin', 'uploader'].includes(this.role); };

  return User;
};
