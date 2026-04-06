const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('TenantDataConfig', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: 'tenant_id' },

    // Data categories — all boolean, default true except giftCore which is always true
    includeGiftCore: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_gift_core' },
    includeConstituentContact: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_constituent_contact' },
    includeCampaigns: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_campaigns' },
    includeAppeals: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_appeals' },
    includeFunds: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_funds' },
    includeFundraiserCredits: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_fundraiser_credits' },
    includeSoftCredits: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_soft_credits' },
    includeMatchingGifts: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_matching_gifts' },
    includeConstituentCodes: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'include_constituent_codes' },

    // Fiscal year configuration
    fiscalYearStartMonth: { type: DataTypes.INTEGER, defaultValue: 4, field: 'fiscal_year_start_month' },

    // AI-inferred department configuration (populated after first import)
    detectedDepartments: { type: DataTypes.JSONB, defaultValue: null, field: 'detected_departments' },
    departmentClassificationRules: { type: DataTypes.JSONB, defaultValue: null, field: 'department_classification_rules' },

    // Onboarding state tracking
    onboardingStep: { type: DataTypes.INTEGER, defaultValue: 1, field: 'onboarding_step' },
    onboardingCompletedAt: { type: DataTypes.DATE, defaultValue: null, field: 'onboarding_completed_at' },

    // Saved query instructions for future re-uploads
    queryInstructions: { type: DataTypes.JSONB, defaultValue: null, field: 'query_instructions' },
  }, {
    tableName: 'tenant_data_configs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });
};
