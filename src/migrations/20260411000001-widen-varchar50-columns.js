'use strict';

/**
 * Widen all VARCHAR(50) columns in CRM tables to VARCHAR(255).
 * RE NXT exports can have IDs, phone numbers, and status values
 * exceeding 50 characters.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = [
      // crm_gifts
      { table: 'crm_gifts', column: 'gift_id', nullable: false },
      { table: 'crm_gifts', column: 'gift_status' },
      { table: 'crm_gifts', column: 'system_record_id' },
      { table: 'crm_gifts', column: 'constituent_id' },
      { table: 'crm_gifts', column: 'constituent_phone' },
      { table: 'crm_gifts', column: 'fund_id' },
      { table: 'crm_gifts', column: 'campaign_id' },
      { table: 'crm_gifts', column: 'appeal_id' },
      { table: 'crm_gifts', column: 'package_id' },
      { table: 'crm_gifts', column: 'department' },
      // crm_gift_fundraisers
      { table: 'crm_gift_fundraisers', column: 'gift_id', nullable: false },
      // crm_gift_soft_credits
      { table: 'crm_gift_soft_credits', column: 'gift_id', nullable: false },
      { table: 'crm_gift_soft_credits', column: 'recipient_id' },
      // crm_gift_matches
      { table: 'crm_gift_matches', column: 'gift_id', nullable: false },
      { table: 'crm_gift_matches', column: 'match_gift_id' },
    ];

    for (const { table, column, nullable } of columns) {
      await queryInterface.changeColumn(table, column, {
        type: Sequelize.STRING(255),
        allowNull: nullable === false ? false : true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Reverting would risk truncation — intentionally left empty
  },
};
