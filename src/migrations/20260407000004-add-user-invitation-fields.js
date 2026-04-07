'use strict';

/**
 * Add invitation fields to users table for the team invite flow.
 * Also adds an index on invitation_token for fast lookup.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'invitation_token', {
      type: Sequelize.STRING(64),
      allowNull: true,
      unique: true,
    });
    await queryInterface.addColumn('users', 'invitation_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'invited_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'invitation_token');
    await queryInterface.removeColumn('users', 'invitation_expires_at');
    await queryInterface.removeColumn('users', 'invited_by');
  },
};
