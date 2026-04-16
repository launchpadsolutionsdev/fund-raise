const { DataTypes } = require('sequelize');

const SCOPE_TYPES = ['default', 'fund', 'campaign', 'appeal'];

/**
 * ThankYouTemplate — canned thank-you letter templates with merge fields.
 *
 * Distinct from WritingTemplate (which stores prompt-parameter presets for
 * the AI letter generator). These are static templates the team pre-writes
 * and re-uses — e.g. "Legacy Giving gala thank-you" or "Capital Campaign
 * $10K+ acknowledgement". A gift or donor view can pick the most specific
 * matching template and fill in the merge fields to produce a ready-to-send
 * letter without involving the LLM at all.
 *
 * Scope resolution when choosing a template for a specific gift:
 *   1. scopeType='fund'     AND fund_id matches
 *   2. scopeType='campaign' AND campaign_id matches
 *   3. scopeType='appeal'   AND appeal_id matches
 *   4. scopeType='default'  (catch-all, usually exactly one per tenant)
 *
 * Merge fields understood by the renderer live in
 * src/services/thankYouTemplateService.js. The UI shows the list as a
 * "paste-in" reference alongside the editor.
 *
 * Tenant-scoped: RLS policies on tenant_id guarantee the template index,
 * show, update, and delete endpoints never leak across organizations.
 */
module.exports = (sequelize) => {
  const ThankYouTemplate = sequelize.define('ThankYouTemplate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'tenant_id',
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Optional subject line; useful when the template drives email composition.
    subject: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    // The letter body with {{merge_field}} placeholders. See
    // thankYouTemplateService.getSupportedMergeFields() for the list.
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // One of 'default' | 'fund' | 'campaign' | 'appeal'. A 'default' row is
    // used when no other scope matches; each tenant should have exactly one
    // but we don't enforce that at the DB level so editors can stage a
    // new default before archiving the old one.
    scopeType: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'default',
      field: 'scope_type',
      validate: { isIn: [SCOPE_TYPES] },
    },
    // When scopeType is 'fund' / 'campaign' / 'appeal', we match on the
    // corresponding crm_gifts column. Stored as STRING (matching crm_gifts).
    fundId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'fund_id',
    },
    campaignId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'campaign_id',
    },
    appealId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'appeal_id',
    },
    // Human label captured at save time so the admin UI doesn't have to
    // join crm_gifts to show "Capital Campaign 2026" next to the template.
    scopeLabel: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'scope_label',
    },
    isArchived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_archived',
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'created_by',
    },
  }, {
    tableName: 'thank_you_templates',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['tenant_id', 'is_archived'] },
      { fields: ['tenant_id', 'scope_type'] },
      { fields: ['tenant_id', 'fund_id'] },
      { fields: ['tenant_id', 'campaign_id'] },
      { fields: ['tenant_id', 'appeal_id'] },
    ],
  });

  ThankYouTemplate.SCOPE_TYPES = SCOPE_TYPES;

  return ThankYouTemplate;
};
