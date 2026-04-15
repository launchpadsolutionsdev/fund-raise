const { DataTypes } = require('sequelize');

/**
 * TenantBrandVoice — per-tenant writing-voice profile.
 *
 * Admins configure this once; every AI generation in the tenant then
 * splices the formatted block into the system prompt as a second
 * `cache_control: ephemeral` block, nested between the shared
 * FOUNDATION_WRITING_GUIDE (warm across tenants) and the
 * feature-specific prompt (unique per call).
 *
 * At most one row per tenant (unique on tenant_id). Leaving this
 * unset is a valid state — no voice block is inserted.
 */
module.exports = (sequelize) => {
  const TenantBrandVoice = sequelize.define('TenantBrandVoice', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: 'tenant_id',
    },
    // Free-form description of the tenant's voice. Most important field.
    // e.g. "Warm and conversational — we speak to donors like neighbours,
    //       not clients. Avoid corporate jargon. Short sentences."
    toneDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'tone_description',
    },
    // Core values the Foundation wants every piece of writing to reflect.
    // e.g. ["community-first", "radical transparency", "joyful urgency"]
    organizationValues: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: 'organization_values',
    },
    // Vocabulary overrides. Each entry is { from: "donor", to: "partner" }
    // so the LLM knows to substitute consistently.
    preferredTerms: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: 'preferred_terms',
    },
    // Phrases or words the org never wants to see in output.
    // e.g. ["truly", "amazing", "at the end of the day"]
    bannedPhrases: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: 'banned_phrases',
    },
    // Signature block for letters that need one. The LLM uses it verbatim
    // when the output format calls for a signature.
    signatureBlock: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'signature_block',
    },
    // Catch-all for anything else the org wants the LLM to know.
    // e.g. "We refer to our hospital as 'the General'."
    additionalGuidance: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'additional_guidance',
    },
    // Kill switch — admins can toggle voice off temporarily without
    // losing their configuration.
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active',
    },
    updatedById: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'updated_by_id',
    },
  }, {
    tableName: 'tenant_brand_voices',
    timestamps: true,
    underscored: true,
  });

  return TenantBrandVoice;
};
