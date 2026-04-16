'use strict';

/**
 * Adds manually-entered Major Gifts pledge metrics to philanthropy_narratives:
 * mg_pledged_count, mg_pledged_amount, mg_gifts_received_amount.
 *
 * These are tracked manually by the Major Gifts manager (not derivable
 * from standard gift data).  Nullable so they don't affect other depts.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('philanthropy_narratives', 'mg_pledged_count', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('philanthropy_narratives', 'mg_pledged_amount', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('philanthropy_narratives', 'mg_gifts_received_amount', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('philanthropy_narratives', 'mg_pledged_count');
    await queryInterface.removeColumn('philanthropy_narratives', 'mg_pledged_amount');
    await queryInterface.removeColumn('philanthropy_narratives', 'mg_gifts_received_amount');
  },
};
