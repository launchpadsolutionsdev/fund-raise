'use strict';

/**
 * Re-run VARCHAR(50) → VARCHAR(255) widening with raw SQL.
 * Previous migration may have been marked as run without actually
 * altering the columns.
 */
module.exports = {
  async up(queryInterface) {
    const alterations = [
      'ALTER TABLE crm_gifts ALTER COLUMN gift_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN gift_status TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN system_record_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN constituent_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN constituent_phone TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN fund_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN campaign_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN appeal_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN package_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gifts ALTER COLUMN department TYPE VARCHAR(255)',
      'ALTER TABLE crm_gift_fundraisers ALTER COLUMN gift_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gift_soft_credits ALTER COLUMN gift_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gift_soft_credits ALTER COLUMN recipient_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gift_matches ALTER COLUMN gift_id TYPE VARCHAR(255)',
      'ALTER TABLE crm_gift_matches ALTER COLUMN match_gift_id TYPE VARCHAR(255)',
    ];

    for (const sql of alterations) {
      try {
        await queryInterface.sequelize.query(sql);
        console.log('[Migration] OK:', sql);
      } catch (err) {
        console.warn('[Migration] Warning:', sql, '-', err.message);
      }
    }
  },

  async down() {},
};
