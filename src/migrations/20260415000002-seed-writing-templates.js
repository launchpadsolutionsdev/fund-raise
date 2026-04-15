'use strict';

/**
 * Seed platform Quick-Start templates for the Writing Assistant.
 *
 * Each row pre-fills the three pill rows on the Writing Assistant page
 * (mode + content type + tone). Personal context is left blank — that's
 * what staff fill in.
 *
 * Idempotent: down() removes only these named platform rows so it can be
 * re-run safely against partially-seeded environments.
 */

const SEEDS = [
  {
    name: 'Donor Email — Stewardship',
    description: 'Warm, relationship-building email to a donor between gifts.',
    icon: 'envelope-heart',
    params: {
      mode: 'Draft from scratch',
      contentType: 'Donor email',
      tone: 'Warm & personal',
    },
    sort_order: 10,
  },
  {
    name: 'Polish My Draft',
    description: 'Tighten grammar, flow, and word choice while preserving your voice.',
    icon: 'magic',
    params: {
      mode: 'Polish/edit my draft',
      contentType: 'General correspondence',
      tone: 'Professional & formal',
    },
    sort_order: 20,
  },
  {
    name: 'Reply to a Donor',
    description: 'Compose a thoughtful reply to a message you\'ve received.',
    icon: 'reply',
    params: {
      mode: 'Reply to a message',
      contentType: 'Donor email',
      tone: 'Warm & personal',
    },
    sort_order: 30,
  },
  {
    name: 'Event Invitation',
    description: 'Inviting tone for a foundation event, gala, or briefing.',
    icon: 'calendar-event',
    params: {
      mode: 'Draft from scratch',
      contentType: 'Event invitation',
      tone: 'Celebratory',
    },
    sort_order: 40,
  },
  {
    name: 'Sympathy / Condolence',
    description: 'Brief, respectful note of condolence on the Foundation\'s behalf.',
    icon: 'heart',
    params: {
      mode: 'Draft from scratch',
      contentType: 'Sympathy/condolence card',
      tone: 'Empathetic',
    },
    sort_order: 50,
  },
  {
    name: 'Follow-Up After Meeting',
    description: 'Timely, personal follow-up that references your prior conversation.',
    icon: 'chat-dots',
    params: {
      mode: 'Draft from scratch',
      contentType: 'Follow-up email',
      tone: 'Professional & formal',
    },
    sort_order: 60,
  },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const rows = SEEDS.map((s) => ({
      scope: 'platform',
      tenant_id: null,
      user_id: null,
      feature: 'writing',
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

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('writing_templates', {
      scope: 'platform',
      feature: 'writing',
      name: { [Sequelize.Op.in]: SEEDS.map((s) => s.name) },
    });
  },
};
