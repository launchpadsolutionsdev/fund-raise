const { Sequelize } = require('sequelize');
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
let dbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/foundation_dashboard';

// Render uses postgres:// but Sequelize prefers postgresql://
if (dbUrl.startsWith('postgres://')) {
  dbUrl = dbUrl.replace('postgres://', 'postgresql://');
}

const sequelizeOptions = {
  dialect: 'postgres',
  logging: env === 'development' ? console.log : false,
};

// Render PostgreSQL requires SSL in production
if (env === 'production') {
  sequelizeOptions.dialectOptions = {
    ssl: { require: true, rejectUnauthorized: false },
  };
}

const sequelize = new Sequelize(dbUrl, sequelizeOptions);

// Import models
const Tenant = require('./tenant')(sequelize);
const User = require('./user')(sequelize);
const Snapshot = require('./snapshot')(sequelize);
const DepartmentSummary = require('./departmentSummary')(sequelize);
const GiftTypeBreakdown = require('./giftTypeBreakdown')(sequelize);
const SourceBreakdown = require('./sourceBreakdown')(sequelize);
const FundBreakdown = require('./fundBreakdown')(sequelize);
const RawGift = require('./rawGift')(sequelize);
const BlackbaudToken = require('./blackbaudToken')(sequelize);

// Associations
Tenant.hasMany(User, { foreignKey: 'tenantId' });
User.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(Snapshot, { foreignKey: 'tenantId' });
Snapshot.belongsTo(Tenant, { foreignKey: 'tenantId' });

User.hasMany(Snapshot, { foreignKey: 'uploadedBy' });
Snapshot.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });

Snapshot.hasMany(DepartmentSummary, { foreignKey: 'snapshotId', onDelete: 'CASCADE' });
DepartmentSummary.belongsTo(Snapshot, { foreignKey: 'snapshotId' });

Snapshot.hasMany(GiftTypeBreakdown, { foreignKey: 'snapshotId', onDelete: 'CASCADE' });
GiftTypeBreakdown.belongsTo(Snapshot, { foreignKey: 'snapshotId' });

Snapshot.hasMany(SourceBreakdown, { foreignKey: 'snapshotId', onDelete: 'CASCADE' });
SourceBreakdown.belongsTo(Snapshot, { foreignKey: 'snapshotId' });

Snapshot.hasMany(FundBreakdown, { foreignKey: 'snapshotId', onDelete: 'CASCADE' });
FundBreakdown.belongsTo(Snapshot, { foreignKey: 'snapshotId' });

Snapshot.hasMany(RawGift, { foreignKey: 'snapshotId', onDelete: 'CASCADE' });
RawGift.belongsTo(Snapshot, { foreignKey: 'snapshotId' });

Tenant.hasMany(BlackbaudToken, { foreignKey: 'tenantId' });
BlackbaudToken.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(BlackbaudToken, { foreignKey: 'connectedBy' });
BlackbaudToken.belongsTo(User, { foreignKey: 'connectedBy', as: 'connector' });

module.exports = {
  sequelize,
  Tenant,
  User,
  Snapshot,
  DepartmentSummary,
  GiftTypeBreakdown,
  SourceBreakdown,
  FundBreakdown,
  RawGift,
  BlackbaudToken,
};
