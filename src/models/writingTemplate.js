const { DataTypes } = require('sequelize');

const SCOPES = ['platform', 'tenant'];
const FEATURES = ['writing', 'thankYou', 'impact', 'meetingPrep', 'digest'];

/**
 * WritingTemplate — pre-built parameter sets for the writing features.
 *
 * Two scopes share one table:
 *   - 'platform' rows are seeded via migration; tenant_id and user_id are NULL.
 *     Every tenant sees the same platform templates.
 *   - 'tenant' rows are created by users; tenant_id (and usually user_id) are
 *     set. Visible only within that tenant. Reserved for a follow-up commit;
 *     the schema is designed to support it without further migration.
 *
 * Templates are feature-scoped: a Thank-You template doesn't show up in the
 * Meeting Prep generator. The shape of `params` matches the body the
 * corresponding generate endpoint expects (less the constituentId, which is
 * always picked at runtime).
 */
module.exports = (sequelize) => {
  const WritingTemplate = sequelize.define('WritingTemplate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    scope: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: { isIn: [SCOPES] },
    },
    tenantId: {
      // NULL for platform templates, set for tenant-scoped templates.
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'tenant_id',
    },
    userId: {
      // NULL for platform templates and tenant-shared templates;
      // set for personal templates (reserved for follow-up).
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'user_id',
    },
    feature: {
      type: DataTypes.STRING(32),
      allowNull: false,
      validate: { isIn: [FEATURES] },
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    icon: {
      // Bootstrap icon name without the "bi-" prefix, e.g. "star-fill".
      // Renderer adds the prefix and falls back to a default if absent.
      type: DataTypes.STRING(48),
      allowNull: true,
    },
    params: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'sort_order',
    },
    isArchived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_archived',
    },
  }, {
    tableName: 'writing_templates',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['scope', 'feature'] },
      { fields: ['tenant_id', 'feature'] },
      { fields: ['feature', 'sort_order'] },
    ],
  });

  WritingTemplate.SCOPES = SCOPES;
  WritingTemplate.FEATURES = FEATURES;

  return WritingTemplate;
};
