'use strict';

/**
 * Seed platform Quick-Start templates for the Impact Stories,
 * Meeting Prep, and Weekly Digest features.
 *
 * Idempotent: down() removes only these named platform rows, scoped to
 * each feature, so it can be re-run safely against partially-seeded envs.
 */

const IMPACT_SEEDS = [
  {
    name: 'Annual Report — Patient Care',
    description: 'Polished narrative ready for the Foundation\'s annual report.',
    icon: 'journal-text',
    params: { format: 'Annual Report Narrative', focus: 'Patient Care' },
    sort_order: 10,
  },
  {
    name: 'Social Post — Equipment Win',
    description: 'Punchy, share-ready post celebrating new equipment funded by donors.',
    icon: 'megaphone',
    params: { format: 'Social Media Post', focus: 'Equipment & Technology' },
    sort_order: 20,
  },
  {
    name: 'Newsletter — Research',
    description: 'Warm, donor-newsletter style update on a research advance.',
    icon: 'newspaper',
    params: { format: 'Donor Newsletter', focus: 'Research' },
    sort_order: 30,
  },
  {
    name: 'Board Slide — Education',
    description: 'Data-driven board presentation slide on education and training impact.',
    icon: 'easel',
    params: { format: 'Board Presentation Slide', focus: 'Education & Training' },
    sort_order: 40,
  },
  {
    name: 'Website Feature — Patient Story',
    description: 'Long-form, anonymized patient story for the Foundation\'s website.',
    icon: 'globe',
    params: { format: 'Website Feature', focus: 'Patient Care' },
    sort_order: 50,
  },
];

const MEETING_SEEDS = [
  {
    name: 'Board Presentation (60 min)',
    description: 'Comprehensive board update with KPIs, talking points, and discussion questions.',
    icon: 'building',
    params: { meetingType: 'Board Presentation', duration: '60' },
    sort_order: 10,
  },
  {
    name: 'Donor Cultivation (30 min)',
    description: 'Briefing for a one-on-one cultivation meeting with a prospective donor.',
    icon: 'person-hearts',
    params: { meetingType: 'New Donor Cultivation', duration: '30' },
    sort_order: 20,
  },
  {
    name: 'Department Check-In (30 min)',
    description: 'Quick internal department sync — progress, blockers, next steps.',
    icon: 'people',
    params: { meetingType: 'Department Check-In', duration: '30' },
    sort_order: 30,
  },
  {
    name: 'Campaign Strategy (90 min)',
    description: 'Working session for an active or upcoming campaign.',
    icon: 'bullseye',
    params: { meetingType: 'Campaign Strategy Session', duration: '90' },
    sort_order: 40,
  },
  {
    name: 'Year-End Review (60 min)',
    description: 'Reflective session covering the full year\'s fundraising performance.',
    icon: 'calendar-check',
    params: { meetingType: 'Year-End Review', duration: '60' },
    sort_order: 50,
  },
];

const DIGEST_SEEDS = [
  {
    name: 'Team Update — Casual',
    description: 'Friendly weekly recap for the internal fundraising team.',
    icon: 'people',
    params: { tone: 'casual', audience: 'team' },
    sort_order: 10,
  },
  {
    name: 'Leadership Brief — Strategic',
    description: 'Data-driven, decision-oriented digest for senior leadership.',
    icon: 'graph-up',
    params: { tone: 'strategic', audience: 'leadership' },
    sort_order: 20,
  },
  {
    name: 'Board Update — Professional',
    description: 'Polished weekly digest formatted for the Board of Directors.',
    icon: 'building',
    params: { tone: 'professional', audience: 'board' },
    sort_order: 30,
  },
  {
    name: 'All-Staff — Celebratory',
    description: 'Upbeat, all-staff digest leading with wins and momentum.',
    icon: 'trophy',
    params: { tone: 'celebratory', audience: 'all_staff' },
    sort_order: 40,
  },
];

function buildRows(feature, seeds, now) {
  return seeds.map((s) => ({
    scope: 'platform',
    tenant_id: null,
    user_id: null,
    feature,
    name: s.name,
    description: s.description,
    icon: s.icon,
    params: JSON.stringify(s.params),
    sort_order: s.sort_order,
    is_archived: false,
    created_at: now,
    updated_at: now,
  }));
}

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert('writing_templates', [
      ...buildRows('impact', IMPACT_SEEDS, now),
      ...buildRows('meetingPrep', MEETING_SEEDS, now),
      ...buildRows('digest', DIGEST_SEEDS, now),
    ]);
  },

  async down(queryInterface, Sequelize) {
    const Op = Sequelize.Op;
    await queryInterface.bulkDelete('writing_templates', {
      [Op.or]: [
        { scope: 'platform', feature: 'impact',      name: { [Op.in]: IMPACT_SEEDS.map((s) => s.name) } },
        { scope: 'platform', feature: 'meetingPrep', name: { [Op.in]: MEETING_SEEDS.map((s) => s.name) } },
        { scope: 'platform', feature: 'digest',      name: { [Op.in]: DIGEST_SEEDS.map((s) => s.name) } },
      ],
    });
  },
};
