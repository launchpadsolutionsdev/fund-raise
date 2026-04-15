'use strict';

/**
 * Add use_exemplars to tenant_brand_voices.
 *
 * Controls whether the tenant's saved writing_outputs rows are
 * automatically injected as few-shot examples into future generations.
 * Defaults to true — the feature is on out of the box; admins can flip
 * the switch from the Brand Voice settings page.
 *
 * Existing rows get the default. Tenants without any brand voice row
 * are treated as use_exemplars = true by the consuming service, so
 * adding this column is purely additive — no behaviour change for
 * tenants who haven't configured a voice yet.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tenant_brand_voices', 'use_exemplars', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tenant_brand_voices', 'use_exemplars');
  },
};
