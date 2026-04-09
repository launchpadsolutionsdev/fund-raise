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
  pool: { max: 10, min: 1, acquire: 30000, idle: 10000 },
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
const Conversation = require('./conversation')(sequelize);
const Post = require('./post')(sequelize);
const PostComment = require('./postComment')(sequelize);
const Milestone = require('./milestone')(sequelize);
const QuickNote = require('./quickNote')(sequelize);
const Kudos = require('./kudos')(sequelize);
const CrmImport = require('./crmImport')(sequelize);
const CrmGift = require('./crmGift')(sequelize);
const CrmGiftFundraiser = require('./crmGiftFundraiser')(sequelize);
const CrmGiftSoftCredit = require('./crmGiftSoftCredit')(sequelize);
const CrmGiftMatch = require('./crmGiftMatch')(sequelize);
const FundraiserGoal = require('./fundraiserGoal')(sequelize);
const DepartmentGoal = require('./departmentGoal')(sequelize);
const TenantDataConfig = require('./tenantDataConfig')(sequelize);
const Action = require('./action')(sequelize);
const ActionComment = require('./actionComment')(sequelize);
const AuditLog = require('./auditLog')(sequelize);
const AiUsageLog = require('./aiUsageLog')(sequelize);

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

Tenant.hasMany(Conversation, { foreignKey: 'tenantId' });
Conversation.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(Conversation, { foreignKey: 'userId' });
Conversation.belongsTo(User, { foreignKey: 'userId' });

// Posts & Comments
Tenant.hasMany(Post, { foreignKey: 'tenantId' });
Post.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(Post, { foreignKey: 'authorId' });
Post.belongsTo(User, { foreignKey: 'authorId', as: 'author' });
Post.hasMany(PostComment, { foreignKey: 'postId', as: 'comments', onDelete: 'CASCADE' });
PostComment.belongsTo(Post, { foreignKey: 'postId' });
User.hasMany(PostComment, { foreignKey: 'authorId' });
PostComment.belongsTo(User, { foreignKey: 'authorId', as: 'author' });

// Milestones
Tenant.hasMany(Milestone, { foreignKey: 'tenantId' });
Milestone.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(Milestone, { foreignKey: 'createdById' });
Milestone.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

// Quick Notes
User.hasMany(QuickNote, { foreignKey: 'userId' });
QuickNote.belongsTo(User, { foreignKey: 'userId' });
Tenant.hasMany(QuickNote, { foreignKey: 'tenantId' });
QuickNote.belongsTo(Tenant, { foreignKey: 'tenantId' });

// Kudos
Tenant.hasMany(Kudos, { foreignKey: 'tenantId' });
Kudos.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(Kudos, { as: 'kudosSent', foreignKey: 'fromUserId' });
Kudos.belongsTo(User, { as: 'fromUser', foreignKey: 'fromUserId' });
User.hasMany(Kudos, { as: 'kudosReceived', foreignKey: 'toUserId' });
Kudos.belongsTo(User, { as: 'toUser', foreignKey: 'toUserId' });

// Tenant data config
Tenant.hasOne(TenantDataConfig, { foreignKey: 'tenantId' });
TenantDataConfig.belongsTo(Tenant, { foreignKey: 'tenantId' });

// CRM Import associations
Tenant.hasMany(CrmImport, { foreignKey: 'tenantId' });
CrmImport.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(CrmImport, { foreignKey: 'uploadedBy' });
CrmImport.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });

Tenant.hasMany(CrmGift, { foreignKey: 'tenantId' });
CrmGift.belongsTo(Tenant, { foreignKey: 'tenantId' });

CrmGift.hasMany(CrmGiftFundraiser, { foreignKey: 'giftId', sourceKey: 'giftId', as: 'fundraisers', constraints: false });
CrmGiftFundraiser.belongsTo(CrmGift, { foreignKey: 'giftId', targetKey: 'giftId', constraints: false });

CrmGift.hasMany(CrmGiftSoftCredit, { foreignKey: 'giftId', sourceKey: 'giftId', as: 'softCredits', constraints: false });
CrmGiftSoftCredit.belongsTo(CrmGift, { foreignKey: 'giftId', targetKey: 'giftId', constraints: false });

CrmGift.hasMany(CrmGiftMatch, { foreignKey: 'giftId', sourceKey: 'giftId', as: 'matches', constraints: false });
CrmGiftMatch.belongsTo(CrmGift, { foreignKey: 'giftId', targetKey: 'giftId', constraints: false });

// Audit Logs
Tenant.hasMany(AuditLog, { foreignKey: 'tenantId' });
AuditLog.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(AuditLog, { foreignKey: 'userId' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'actor' });

// Actions & ActionComments
Tenant.hasMany(Action, { foreignKey: 'tenantId' });
Action.belongsTo(Tenant, { foreignKey: 'tenantId' });
Action.belongsTo(User, { as: 'assignedBy', foreignKey: 'assignedById' });
Action.belongsTo(User, { as: 'assignedTo', foreignKey: 'assignedToId' });
Action.belongsTo(User, { as: 'resolvedBy', foreignKey: 'resolvedById' });
Action.hasMany(ActionComment, { foreignKey: 'actionId', as: 'comments', onDelete: 'CASCADE' });
ActionComment.belongsTo(Action, { foreignKey: 'actionId' });
ActionComment.belongsTo(User, { foreignKey: 'userId', as: 'author' });

// AI Usage Logs
Tenant.hasMany(AiUsageLog, { foreignKey: 'tenantId' });
AiUsageLog.belongsTo(Tenant, { foreignKey: 'tenantId' });
User.hasMany(AiUsageLog, { foreignKey: 'userId' });
AiUsageLog.belongsTo(User, { foreignKey: 'userId' });

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
  Conversation,
  Post,
  PostComment,
  Milestone,
  QuickNote,
  Kudos,
  CrmImport,
  CrmGift,
  CrmGiftFundraiser,
  CrmGiftSoftCredit,
  CrmGiftMatch,
  FundraiserGoal,
  DepartmentGoal,
  TenantDataConfig,
  Action,
  ActionComment,
  AuditLog,
  AiUsageLog,
};
