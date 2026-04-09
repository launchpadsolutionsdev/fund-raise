const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ReNxtConfigCache = sequelize.define('ReNxtConfigCache', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'tenant_id',
    },
    configType: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'config_type',
    },
    configValues: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: 'config_values',
    },
    fetchedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'fetched_at',
    },
  }, {
    tableName: 're_nxt_config_cache',
    timestamps: false,
  });

  return ReNxtConfigCache;
};
