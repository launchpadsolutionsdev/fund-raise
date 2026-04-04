const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PostComment = sequelize.define('PostComment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    postId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'post_id',
    },
    authorId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'author_id',
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  }, {
    tableName: 'post_comments',
    timestamps: true,
    underscored: true,
  });

  return PostComment;
};
