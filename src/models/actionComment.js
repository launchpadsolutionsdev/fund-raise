const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ActionComment = sequelize.define('ActionComment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    actionId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'action_id',
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id',
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    isSystemComment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_system_comment',
    },
  }, {
    tableName: 'action_comments',
    timestamps: true,
    underscored: true,
  });

  return ActionComment;
};
