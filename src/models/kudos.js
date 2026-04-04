const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Kudos', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },
    fromUserId: { type: DataTypes.INTEGER, allowNull: false, field: 'from_user_id' },
    toUserId: { type: DataTypes.INTEGER, allowNull: false, field: 'to_user_id' },
    message: { type: DataTypes.TEXT, allowNull: false },
    category: {
      type: DataTypes.STRING(30),
      defaultValue: 'general',
      // general, teamwork, innovation, above-and-beyond, milestone, mentorship
    },
    emoji: { type: DataTypes.STRING(10), defaultValue: '⭐' },
    reactions: { type: DataTypes.JSONB, defaultValue: {} },
    // reactions: { "❤️": [userId1, userId2], "🎉": [userId3] }
  }, {
    tableName: 'kudos',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });
};
