'use strict';

/**
 * Add a tenant-configurable major-gift threshold.
 *
 * "Major gift" means wildly different dollar amounts depending on the
 * organization:
 *   - A large hospital foundation might set it at $500,000+
 *   - A small community nonprofit might set it at $5,000-$10,000
 *
 * Previously the platform hardcoded $1,000-$10,000 in several places
 * (proactive insights, AI recommendations, retention drilldowns, donor
 * re-engagement). That meant every tenant saw the same definition
 * regardless of their actual major-gift program.
 *
 * This column lets each tenant set their own number. When null/unset the
 * application code falls back to the $10,000 default baked into
 * src/services/majorGiftService.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tenants', 'major_gift_threshold', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      comment: 'Dollar amount at or above which a single gift counts as a "major gift" for this organization. Null → app default ($10,000).',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tenants', 'major_gift_threshold');
  },
};
