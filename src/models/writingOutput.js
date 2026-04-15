const { DataTypes } = require('sequelize');

const FEATURES = ['writing', 'thankYou', 'impact', 'meetingPrep', 'digest'];
const RATINGS = ['helpful', 'neutral', 'not_helpful'];

/**
 * WritingOutput — persisted record of every AI writing generation.
 *
 * Powers:
 *   - Per-user history and saved library
 *   - Rating / feedback loop that feeds prompt improvement
 *   - Token-accounting for the writing features
 *   - Future A/B prompt evaluation (prompt_version)
 *
 * Every successful generation writes a row automatically. Rows are
 * tenant- and user-scoped in the application layer (no RLS policy yet;
 * consistent with ai_usage_logs).
 */
module.exports = (sequelize) => {
  const WritingOutput = sequelize.define('WritingOutput', {
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
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id',
    },
    feature: {
      type: DataTypes.STRING(32),
      allowNull: false,
      validate: { isIn: [FEATURES] },
    },
    // Input parameters used to produce the output. Stored as JSONB so the
    // generation can be replayed or adapted into a template later.
    params: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    // Identifies which prompt variant produced this output. NULL until
    // Phase 3 A/B testing lands; pre-populated here to avoid a later
    // migration.
    promptVersion: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: 'prompt_version',
    },
    generatedText: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'generated_text',
    },
    model: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    // Token accounting — populated once prompt-caching/usage-tracking
    // is wired in (Phase 1 Item 3). Nullable for records written before
    // that change.
    inputTokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'input_tokens',
    },
    outputTokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'output_tokens',
    },
    cacheReadTokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'cache_read_tokens',
    },
    cacheCreationTokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'cache_creation_tokens',
    },
    durationMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'duration_ms',
    },
    // User feedback — powers the learning loop. NULL until the user
    // clicks a rating button.
    rating: {
      type: DataTypes.STRING(16),
      allowNull: true,
      validate: { isIn: [RATINGS] },
    },
    feedbackNote: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'feedback_note',
    },
    // Whether the user explicitly promoted this into their saved library.
    // Every row is kept for history; isSaved = true just marks favourites.
    isSaved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_saved',
    },
    savedName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'saved_name',
    },
    // Soft-delete flag — history endpoints filter these out but we keep
    // the row for aggregate analytics / prompt learning.
    isHidden: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_hidden',
    },
  }, {
    tableName: 'writing_outputs',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['tenant_id', 'created_at'] },
      { fields: ['user_id', 'created_at'] },
      { fields: ['feature', 'created_at'] },
      { fields: ['rating'] },
      { fields: ['is_saved'] },
    ],
  });

  WritingOutput.FEATURES = FEATURES;
  WritingOutput.RATINGS = RATINGS;

  return WritingOutput;
};
