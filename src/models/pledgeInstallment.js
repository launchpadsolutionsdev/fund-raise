const { DataTypes } = require('sequelize');

const STATUSES = ['scheduled', 'partial', 'paid', 'overdue', 'waived', 'written_off'];
const CADENCES = ['monthly', 'quarterly', 'semiannual', 'annual', 'one_time', 'custom'];

/**
 * PledgeInstallment — expected payment schedule for a pledge commitment.
 *
 * Commitments themselves live in crm_gifts (gift_type='Pledge' etc.).
 * This table adds the thing crm_gifts never had: a per-installment
 * expected date and amount, plus the fulfilment link back to the payment
 * gift that satisfied it.
 *
 * Addressing convention matches the other crm_gift_* sibling tables
 * (soft credits, matches, fundraisers): the parent gift is referenced
 * by (tenantId, pledgeGiftId) with no FK constraint because gift_id is
 * unique per-tenant only.
 */
module.exports = (sequelize) => {
  const PledgeInstallment = sequelize.define('PledgeInstallment', {
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
    // References crm_gifts.gift_id on the commitment row
    // (tenant-scoped — addressed via tenantId + pledgeGiftId).
    pledgeGiftId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'pledge_gift_id',
    },
    constituentId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'constituent_id',
    },

    // Expected schedule
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'due_date',
    },
    expectedAmount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      field: 'expected_amount',
    },
    installmentNumber: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'installment_number',
    },
    totalInstallments: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'total_installments',
    },
    cadence: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: { isIn: [CADENCES] },
    },

    // Actual fulfilment
    paidAmount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      field: 'paid_amount',
    },
    paidDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'paid_date',
    },
    // Optional link to the crm_gifts.gift_id of the payment row.
    paidGiftId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'paid_gift_id',
    },

    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'scheduled',
      validate: { isIn: [STATUSES] },
    },

    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'pledge_installments',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['tenant_id', 'due_date'] },
      { fields: ['tenant_id', 'pledge_gift_id'] },
      { fields: ['tenant_id', 'constituent_id'] },
      { fields: ['tenant_id', 'status', 'due_date'] },
    ],
  });

  PledgeInstallment.STATUSES = STATUSES;
  PledgeInstallment.CADENCES = CADENCES;

  return PledgeInstallment;
};
