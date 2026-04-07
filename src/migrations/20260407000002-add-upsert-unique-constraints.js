'use strict';

/**
 * Add unique constraints needed for UPSERT (ON CONFLICT) import strategy.
 *
 * These constraints define the natural keys from Blackbaud:
 * - crm_gifts: (tenant_id, gift_id) — one gift per tenant per Blackbaud gift ID
 * - crm_gift_fundraisers: (tenant_id, gift_id, fundraiser_name) — one credit per fundraiser per gift
 * - crm_gift_soft_credits: (tenant_id, gift_id, recipient_id) — one soft credit per recipient per gift
 * - crm_gift_matches: (tenant_id, gift_id, match_gift_id) — one match per gift
 *
 * Deduplicates existing data before adding constraints (keeps the most recent row).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // crm_gifts — may already exist from partial run
    const [giftsIdx] = await queryInterface.sequelize.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'crm_gifts_tenant_gift_unique'`
    );
    if (giftsIdx.length === 0) {
      await queryInterface.sequelize.query(`
        DELETE FROM crm_gifts a USING crm_gifts b
        WHERE a.id < b.id AND a.tenant_id = b.tenant_id AND a.gift_id = b.gift_id;
      `);
      await queryInterface.addIndex('crm_gifts', ['tenant_id', 'gift_id'], {
        unique: true,
        name: 'crm_gifts_tenant_gift_unique',
      });
    }

    // crm_gift_fundraisers — deduplicate then constrain
    await queryInterface.sequelize.query(`
      DELETE FROM crm_gift_fundraisers a USING crm_gift_fundraisers b
      WHERE a.id < b.id
        AND a.tenant_id = b.tenant_id
        AND a.gift_id = b.gift_id
        AND a.fundraiser_name = b.fundraiser_name;
    `);
    await queryInterface.addIndex('crm_gift_fundraisers', ['tenant_id', 'gift_id', 'fundraiser_name'], {
      unique: true,
      name: 'crm_gift_fundraisers_tenant_gift_name_unique',
    });

    // crm_gift_soft_credits — deduplicate then constrain
    await queryInterface.sequelize.query(`
      DELETE FROM crm_gift_soft_credits a USING crm_gift_soft_credits b
      WHERE a.id < b.id
        AND a.tenant_id = b.tenant_id
        AND a.gift_id = b.gift_id
        AND a.recipient_id = b.recipient_id;
    `);
    await queryInterface.addIndex('crm_gift_soft_credits', ['tenant_id', 'gift_id', 'recipient_id'], {
      unique: true,
      name: 'crm_gift_soft_credits_tenant_gift_recipient_unique',
    });

    // crm_gift_matches — deduplicate then constrain
    await queryInterface.sequelize.query(`
      DELETE FROM crm_gift_matches a USING crm_gift_matches b
      WHERE a.id < b.id
        AND a.tenant_id = b.tenant_id
        AND a.gift_id = b.gift_id
        AND a.match_gift_id = b.match_gift_id;
    `);
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
