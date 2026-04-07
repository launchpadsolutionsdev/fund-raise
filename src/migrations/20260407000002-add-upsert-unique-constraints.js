'use strict';

/**
 * Add unique constraints needed for UPSERT (ON CONFLICT) import strategy.
 *
 * These constraints define the natural keys from Blackbaud:
 * - crm_gifts: (tenant_id, gift_id) — one gift per tenant per Blackbaud gift ID
 * - crm_gift_fundraisers: (tenant_id, gift_id, fundraiser_name) — one credit per fundraiser per gift
 * - crm_gift_soft_credits: (tenant_id, gift_id, recipient_id) — one soft credit per recipient per gift
 * - crm_gift_matches: (tenant_id, gift_id, match_gift_id) — one match per gift
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'gift_id'], {
      unique: true,
      name: 'crm_gifts_tenant_gift_unique',
    });

    await queryInterface.addIndex('crm_gift_fundraisers', ['tenant_id', 'gift_id', 'fundraiser_name'], {
      unique: true,
      name: 'crm_gift_fundraisers_tenant_gift_name_unique',
    });

    await queryInterface.addIndex('crm_gift_soft_credits', ['tenant_id', 'gift_id', 'recipient_id'], {
      unique: true,
      name: 'crm_gift_soft_credits_tenant_gift_recipient_unique',
    });

    await queryInterface.addIndex('crm_gift_matches', ['tenant_id', 'gift_id', 'match_gift_id'], {
      unique: true,
      name: 'crm_gift_matches_tenant_gift_match_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('crm_gifts', 'crm_gifts_tenant_gift_unique');
    await queryInterface.removeIndex('crm_gift_fundraisers', 'crm_gift_fundraisers_tenant_gift_name_unique');
    await queryInterface.removeIndex('crm_gift_soft_credits', 'crm_gift_soft_credits_tenant_gift_recipient_unique');
    await queryInterface.removeIndex('crm_gift_matches', 'crm_gift_matches_tenant_gift_match_unique');
  },
};
