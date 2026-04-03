const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BlackbaudToken = sequelize.define('BlackbaudToken', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, field: 'tenant_id', allowNull: false },
    connectedBy: { type: DataTypes.INTEGER, field: 'connected_by' },
    accessToken: { type: DataTypes.TEXT, field: 'access_token', allowNull: false },
    refreshToken: { type: DataTypes.TEXT, field: 'refresh_token', allowNull: false },
    tokenType: { type: DataTypes.STRING(50), field: 'token_type', defaultValue: 'Bearer' },
    expiresAt: { type: DataTypes.DATE, field: 'expires_at', allowNull: false },
    environmentId: { type: DataTypes.STRING(255), field: 'environment_id' },
    environmentName: { type: DataTypes.STRING(255), field: 'environment_name' },
    connectedAt: { type: DataTypes.DATE, field: 'connected_at', defaultValue: DataTypes.NOW },
    lastRefreshedAt: { type: DataTypes.DATE, field: 'last_refreshed_at' },
  }, {
    tableName: 'blackbaud_tokens',
    timestamps: false,
  });

  BlackbaudToken.prototype.isExpired = function () {
    return new Date() >= this.expiresAt;
  };

  BlackbaudToken.prototype.expiresInMinutes = function () {
    return Math.max(0, Math.round((this.expiresAt - new Date()) / 60000));
  };

  return BlackbaudToken;
};
