const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Tenant', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    slug: { type: DataTypes.STRING(100), unique: true, allowNull: false },
    logoPath: { type: DataTypes.STRING(255), allowNull: true, field: 'logo_path' },
    missionStatement: { type: DataTypes.TEXT, allowNull: true, field: 'mission_statement' },
    addressLine1: { type: DataTypes.STRING(255), allowNull: true, field: 'address_line1' },
    addressLine2: { type: DataTypes.STRING(255), allowNull: true, field: 'address_line2' },
    city: { type: DataTypes.STRING(100), allowNull: true, field: 'city' },
    state: { type: DataTypes.STRING(50), allowNull: true, field: 'state' },
    zip: { type: DataTypes.STRING(20), allowNull: true, field: 'zip' },
    phone: { type: DataTypes.STRING(30), allowNull: true, field: 'phone' },
    website: { type: DataTypes.STRING(255), allowNull: true, field: 'website' },
    ein: { type: DataTypes.STRING(20), allowNull: true, field: 'ein' },
    fiscalYearStart: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 4, field: 'fiscal_year_start' },
    // Dollar amount at or above which a single gift counts as a "major gift"
    // for this organization. Null → app default ($10,000). See
    // src/services/majorGiftService.js for the resolution rules.
    majorGiftThreshold: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'major_gift_threshold' },
    onboardingCompleted: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'onboarding_completed' },
    onboardingStep: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1, field: 'onboarding_step' },
  }, {
    tableName: 'tenants',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: false,
  });
};
