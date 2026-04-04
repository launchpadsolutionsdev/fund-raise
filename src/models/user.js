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
    // Staff profile fields
    nickname: { type: DataTypes.STRING(100), allowNull: true },
    jobTitle: { type: DataTypes.STRING(150), allowNull: true, field: 'job_title' },
    bio: { type: DataTypes.TEXT, allowNull: true },
    localAvatarPath: { type: DataTypes.STRING(255), allowNull: true, field: 'local_avatar_path' },
  }, {
    tableName: 'users',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: false,
  });

  User.prototype.isAdmin = function () { return this.role === 'admin'; };
  User.prototype.canUpload = function () { return ['admin', 'uploader'].includes(this.role); };

  // Display name: nickname > name > email
  User.prototype.displayName = function () {
    return this.nickname || this.name || this.email;
  };

  // Avatar URL: local upload takes priority over Google avatar
  User.prototype.avatarSrc = function () {
    if (this.localAvatarPath) return '/uploads/avatars/' + this.localAvatarPath;
    if (this.avatarUrl) return this.avatarUrl;
    return null;
  };

  return User;
};
