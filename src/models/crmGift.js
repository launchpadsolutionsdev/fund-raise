const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrmGift', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id' },

    // Gift core
    giftId: { type: DataTypes.STRING(50), allowNull: false, field: 'gift_id' },
    giftAmount: { type: DataTypes.DECIMAL(14, 2), field: 'gift_amount' },
    giftCode: { type: DataTypes.STRING(100), field: 'gift_code' },
    giftDate: { type: DataTypes.DATEONLY, field: 'gift_date' },
    giftStatus: { type: DataTypes.STRING(50), field: 'gift_status' },
    giftPaymentType: { type: DataTypes.STRING(100), field: 'gift_payment_type' },
    giftAcknowledge: { type: DataTypes.STRING(100), field: 'gift_acknowledge' },
    giftAcknowledgeDate: { type: DataTypes.DATEONLY, field: 'gift_acknowledge_date' },
    giftReceiptAmount: { type: DataTypes.DECIMAL(14, 2), field: 'gift_receipt_amount' },
    giftBatchNumber: { type: DataTypes.STRING(100), field: 'gift_batch_number' },
    giftDateAdded: { type: DataTypes.DATEONLY, field: 'gift_date_added' },
    giftDateLastChanged: { type: DataTypes.DATEONLY, field: 'gift_date_last_changed' },

    // Gift extra
    giftType: { type: DataTypes.STRING(100), field: 'gift_type' },
    giftReference: { type: DataTypes.STRING(255), field: 'gift_reference' },
    paymentType: { type: DataTypes.STRING(100), field: 'payment_type' },

    // Constituent
    systemRecordId: { type: DataTypes.STRING(50), field: 'system_record_id' },
    constituentId: { type: DataTypes.STRING(50), field: 'constituent_id' },
    firstName: { type: DataTypes.STRING(255), field: 'first_name' },
    lastName: { type: DataTypes.STRING(255), field: 'last_name' },
    constituentEmail: { type: DataTypes.STRING(255), field: 'constituent_email' },
    constituentPhone: { type: DataTypes.STRING(50), field: 'constituent_phone' },
    constituentAddress: { type: DataTypes.STRING(500), field: 'constituent_address' },
    constituentCity: { type: DataTypes.STRING(255), field: 'constituent_city' },
    constituentState: { type: DataTypes.STRING(100), field: 'constituent_state' },
    constituentZip: { type: DataTypes.STRING(20), field: 'constituent_zip' },
    constituentCountry: { type: DataTypes.STRING(100), field: 'constituent_country' },
    addressType: { type: DataTypes.STRING(100), field: 'address_type' },
    addressDoNotMail: { type: DataTypes.BOOLEAN, field: 'address_do_not_mail' },
    phoneType: { type: DataTypes.STRING(100), field: 'phone_type' },
    phoneDoNotCall: { type: DataTypes.BOOLEAN, field: 'phone_do_not_call' },
    emailType: { type: DataTypes.STRING(100), field: 'email_type' },
    emailDoNotEmail: { type: DataTypes.BOOLEAN, field: 'email_do_not_email' },
    constituentLookupId: { type: DataTypes.STRING(100), field: 'constituent_lookup_id' },
    constituentName: { type: DataTypes.STRING(500), field: 'constituent_name' },
    primaryAddressee: { type: DataTypes.STRING(500), field: 'primary_addressee' },
    constituentCode: { type: DataTypes.STRING(255), field: 'constituent_code' },
    constituentType: { type: DataTypes.STRING(100), field: 'constituent_type' },
    solicitCode: { type: DataTypes.STRING(255), field: 'solicit_code' },

    // Fund
    fundCategory: { type: DataTypes.STRING(255), field: 'fund_category' },
    fundDescription: { type: DataTypes.STRING(500), field: 'fund_description' },
    fundId: { type: DataTypes.STRING(50), field: 'fund_id' },
    fundNotes: { type: DataTypes.TEXT, field: 'fund_notes' },

    // Campaign
    campaignId: { type: DataTypes.STRING(50), field: 'campaign_id' },
    campaignDescription: { type: DataTypes.STRING(500), field: 'campaign_description' },
    campaignNotes: { type: DataTypes.TEXT, field: 'campaign_notes' },
    campaignStartDate: { type: DataTypes.DATEONLY, field: 'campaign_start_date' },
    campaignEndDate: { type: DataTypes.DATEONLY, field: 'campaign_end_date' },

    // Campaign
    campaignCategory: { type: DataTypes.STRING(255), field: 'campaign_category' },

    // Appeal
    appealCategory: { type: DataTypes.STRING(255), field: 'appeal_category' },
    appealDescription: { type: DataTypes.STRING(500), field: 'appeal_description' },
    appealId: { type: DataTypes.STRING(50), field: 'appeal_id' },
    appealNotes: { type: DataTypes.TEXT, field: 'appeal_notes' },
    appealStartDate: { type: DataTypes.DATEONLY, field: 'appeal_start_date' },
    appealEndDate: { type: DataTypes.DATEONLY, field: 'appeal_end_date' },

    // Package
    packageDescription: { type: DataTypes.STRING(500), field: 'package_description' },
    packageId: { type: DataTypes.STRING(50), field: 'package_id' },

    // Pre-computed department classification (set at import time)
    department: { type: DataTypes.STRING(50), field: 'department' },
  }, {
    tableName: 'crm_gifts',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id', 'gift_id'] },
      { fields: ['tenant_id', 'constituent_id'] },
      { fields: ['tenant_id', 'gift_date'] },
      { fields: ['tenant_id', 'fund_id'] },
      { fields: ['tenant_id', 'campaign_id'] },
      { fields: ['tenant_id', 'appeal_id'] },
      { fields: ['tenant_id', 'gift_code'] },
      { fields: ['tenant_id', 'last_name'] },
    ],
  });
};
