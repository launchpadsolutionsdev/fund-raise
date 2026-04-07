/**
 * Feature Flags — Dashboard Degradation Logic
 *
 * When a tenant opts out of certain data categories via TenantDataConfig,
 * the dashboard hides features that depend on the missing data.
 * These flags are passed to every EJS template via middleware.
 */

/**
 * Derive enabled feature flags from a TenantDataConfig record.
 * If no config exists (legacy tenant), all features are enabled.
 *
 * @param {object|null} tenantDataConfig - TenantDataConfig record (plain object or Sequelize instance)
 * @returns {object} Feature flags
 */
function getEnabledFeatures(tenantDataConfig) {
  if (!tenantDataConfig) {
    // No data config = legacy tenant, all features enabled
    return {
      showConstituentDetails: true,
      showCampaignAnalysis: true,
      showAppealAnalysis: true,
      showFundBreakdown: true,
      showFundraiserCredits: true,
      showSoftCredits: true,
      showMatchingGifts: true,
      showConstituentCodes: true,
    };
  }

  const dc = typeof tenantDataConfig.toJSON === 'function'
    ? tenantDataConfig.toJSON()
    : tenantDataConfig;

  return {
    showConstituentDetails: dc.includeConstituentContact !== false,
    showCampaignAnalysis: dc.includeCampaigns !== false,
    showAppealAnalysis: dc.includeAppeals !== false,
    showFundBreakdown: dc.includeFunds !== false,
    showFundraiserCredits: dc.includeFundraiserCredits !== false,
    showSoftCredits: dc.includeSoftCredits !== false,
    showMatchingGifts: dc.includeMatchingGifts !== false,
    showConstituentCodes: dc.includeConstituentCodes !== false,
  };
}

/**
 * Build a description of included/excluded data categories for AI system prompts.
 *
 * @param {object|null} tenantDataConfig
 * @returns {string} Natural language description
 */
function getDataCategoryDescription(tenantDataConfig) {
  if (!tenantDataConfig) {
    return 'This foundation has included all data categories.';
  }

  const dc = typeof tenantDataConfig.toJSON === 'function'
    ? tenantDataConfig.toJSON()
    : tenantDataConfig;

  const categories = [
    { key: 'includeGiftCore', label: 'Gift Data' },
    { key: 'includeConstituentContact', label: 'Constituent Contact Info' },
    { key: 'includeCampaigns', label: 'Campaigns' },
    { key: 'includeAppeals', label: 'Appeals' },
    { key: 'includeFunds', label: 'Funds' },
    { key: 'includeFundraiserCredits', label: 'Fundraiser Credits' },
    { key: 'includeSoftCredits', label: 'Soft Credits' },
    { key: 'includeMatchingGifts', label: 'Matching Gifts' },
    { key: 'includeConstituentCodes', label: 'Constituent Codes' },
  ];

  const included = categories.filter(c => dc[c.key] !== false).map(c => c.label);
  const excluded = categories.filter(c => dc[c.key] === false).map(c => c.label);

  let desc = `This foundation has included the following data categories: ${included.join(', ')}.`;
  if (excluded.length > 0) {
    desc += `\nThe following categories were NOT included: ${excluded.join(', ')}.`;
    desc += '\nDo not reference or query fields from excluded categories. If the user asks about excluded data, explain that their organization chose not to include that data and suggest they can update their data configuration in Settings.';
  }

  return desc;
}

module.exports = { getEnabledFeatures, getDataCategoryDescription };
