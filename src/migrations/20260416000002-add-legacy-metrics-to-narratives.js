'use strict';

/**
 * Adds three manually-entered numeric fields to philanthropy_narratives for
 * Legacy Giving: open_estates, new_expectancies, total_expectancies.
 *
 * These metrics aren't derivable from gift data — they're tracked externally
 * by the Legacy Giving manager and entered via the Philanthropy Report page.
 * Nullable so they don't break existing rows or non-Legacy departments.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('philanthropy_narratives', 'open_estates', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('philanthropy_narratives', 'new_expectancies', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('philanthropy_narratives', 'total_expectancies', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('philanthropy_narratives', 'open_estates');
    await queryInterface.removeColumn('philanthropy_narratives', 'new_expectancies');
    await queryInterface.removeColumn('philanthropy_narratives', 'total_expectancies');
  },
};
