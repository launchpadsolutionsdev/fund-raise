const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Milestone = sequelize.define('Milestone', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'tenant_id',
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // "amount" = dollar threshold, "gifts" = gift count threshold, "donors" = donor count, "custom" = manual
    milestoneType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'amount',
      field: 'milestone_type',
    },
    targetValue: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      field: 'target_value',
    },
    // Which department this milestone applies to (null = organization-wide)
    department: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    reached: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    reachedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'reached_at',
    },
    celebrationEmoji: {
      type: DataTypes.STRING(10),
      allowNull: true,
      defaultValue: '🎉',
      field: 'celebration_emoji',
    },
    createdById: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'created_by_id',
    },
  }, {
    tableName: 'milestones',
    timestamps: true,
    underscored: true,
  });

  return Milestone;
};
