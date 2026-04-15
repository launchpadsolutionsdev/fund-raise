'use strict';

/**
 * Create writing_templates and seed the platform thank-you templates.
 *
 * The seeded rows are owned by no tenant (scope='platform'); they appear in
 * every tenant's Quick Start rail. Tenants will eventually be able to add
 * their own (scope='tenant') without a further migration — the schema and
 * indexes already support that.
 */

const PLATFORM_THANKYOU_SEEDS = [
  {
    name: 'Major Donor — Warm',
    description: 'Heartfelt acknowledgement for a significant gift, written for an established relationship.',
    icon: 'gem',
    params: { letterStyle: 'warm', giftType: 'One-time donation' },
    sort_order: 10,
  },
  {
    name: 'New Donor — Welcome',
    description: 'Acknowledges a first gift and starts the relationship on the right foot.',
    icon: 'person-plus',
    params: { letterStyle: 'warm', giftType: 'One-time donation' },
    sort_order: 20,
  },
  {
    name: 'Monthly Giver',
    description: 'Thanks a sustaining donor for their ongoing monthly support.',
    icon: 'arrow-repeat',
    params: { letterStyle: 'warm', giftType: 'Monthly recurring gift' },
    sort_order: 30,
  },
  {
    name: 'Memorial / Tribute',
    description: 'Respectful acknowledgement of a memorial or tribute gift made in someone\'s honour.',
    icon: 'flower2',
    params: { letterStyle: 'formal', giftType: 'Memorial/tribute gift' },
    sort_order: 40,
  },
  {
    name: 'Corporate Sponsor',
    description: 'Formal partnership-tone thank-you for an event sponsorship or corporate gift.',
    icon: 'building',
    params: { letterStyle: 'formal', giftType: 'Event sponsorship' },
    sort_order: 50,
  },
  {
    name: 'Planned / Legacy Gift',
    description: 'Honours a long-term commitment and conveys the Foundation\'s stewardship promise.',
    icon: 'shield-check',
    params: { letterStyle: 'formal', giftType: 'Planned/legacy gift' },
    sort_order: 60,
  },
  {
    name: 'Quick Card',
    description: 'Short, hand-written-style note for a personal touch — under 150 words.',
    icon: 'envelope-heart',
    params: { letterStyle: 'handwritten' },
    sort_order: 70,
  },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('writing_templates', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      scope: {
        type: Sequelize.STRING(16),
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      feature: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      icon: {
        type: Sequelize.STRING(48),
        allowNull: true,
      },
      params: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_archived: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('writing_templates', ['scope', 'feature']);
    await queryInterface.addIndex('writing_templates', ['tenant_id', 'feature']);
    await queryInterface.addIndex('writing_templates', ['feature', 'sort_order']);

    // Seed platform Thank-You templates.
    const now = new Date();
    const rows = PLATFORM_THANKYOU_SEEDS.map((s) => ({
      scope: 'platform',
      tenant_id: null,
      user_id: null,
      feature: 'thankYou',
      name: s.name,
      description: s.description,
      icon: s.icon,
      params: JSON.stringify(s.params),
      sort_order: s.sort_order,
      is_archived: false,
      created_at: now,
      updated_at: now,
    }));
    await queryInterface.bulkInsert('writing_templates', rows);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('writing_templates');
  },
};
