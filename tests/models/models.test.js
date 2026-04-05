// ---------------------------------------------------------------------------
// Comprehensive model-definition tests for all Sequelize models (except Tenant,
// which has its own dedicated test file).
// ---------------------------------------------------------------------------

// Helper: create a fresh mock sequelize whose `define` returns an object with
// a writable `prototype` so that models which attach instance methods work.
function makeMock() {
  const model = { prototype: {} };
  const mockDefine = jest.fn().mockReturnValue(model);
  return { mockDefine, mockSequelize: { define: mockDefine }, model };
}

// Helper: load a model file and return { mockDefine, model }
function loadModel(file) {
  const { mockDefine, mockSequelize, model } = makeMock();
  require(`../../src/models/${file}`)(mockSequelize);
  return { mockDefine, model };
}

// ---------------------------------------------------------------------------
// 1. User
// ---------------------------------------------------------------------------
describe('User Model', () => {
  let mockDefine, model;
  beforeEach(() => {
    jest.resetModules();
    ({ mockDefine, model } = loadModel('user'));
  });

  it('should define the model with correct name and table name', () => {
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'User',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id' }),
        email: expect.objectContaining({ unique: true, allowNull: false }),
        name: expect.any(Object),
        googleId: expect.objectContaining({ unique: true, field: 'google_id' }),
        role: expect.objectContaining({ defaultValue: 'viewer' }),
        isActive: expect.objectContaining({ defaultValue: true, field: 'is_active' }),
        nickname: expect.objectContaining({ allowNull: true }),
        jobTitle: expect.objectContaining({ field: 'job_title' }),
        bio: expect.objectContaining({ allowNull: true }),
        localAvatarPath: expect.objectContaining({ field: 'local_avatar_path' }),
      }),
      expect.objectContaining({ tableName: 'users' }),
    );
  });

  // Instance method tests
  describe('isAdmin()', () => {
    it('returns true for admin role', () => {
      expect(model.prototype.isAdmin.call({ role: 'admin' })).toBe(true);
    });
    it('returns false for non-admin role', () => {
      expect(model.prototype.isAdmin.call({ role: 'viewer' })).toBe(false);
    });
  });

  describe('canUpload()', () => {
    it('returns true for admin', () => {
      expect(model.prototype.canUpload.call({ role: 'admin' })).toBe(true);
    });
    it('returns true for uploader', () => {
      expect(model.prototype.canUpload.call({ role: 'uploader' })).toBe(true);
    });
    it('returns false for viewer', () => {
      expect(model.prototype.canUpload.call({ role: 'viewer' })).toBe(false);
    });
  });

  describe('displayName()', () => {
    it('prefers nickname', () => {
      expect(model.prototype.displayName.call({ nickname: 'Nick', name: 'Full', email: 'e@e' })).toBe('Nick');
    });
    it('falls back to name', () => {
      expect(model.prototype.displayName.call({ nickname: null, name: 'Full', email: 'e@e' })).toBe('Full');
    });
    it('falls back to email', () => {
      expect(model.prototype.displayName.call({ nickname: null, name: null, email: 'e@e' })).toBe('e@e');
    });
  });

  describe('avatarSrc()', () => {
    it('returns local path when localAvatarPath is set', () => {
      expect(model.prototype.avatarSrc.call({ localAvatarPath: 'pic.jpg', avatarUrl: 'http://g' }))
        .toBe('/uploads/avatars/pic.jpg');
    });
    it('falls back to avatarUrl', () => {
      expect(model.prototype.avatarSrc.call({ localAvatarPath: null, avatarUrl: 'http://g' }))
        .toBe('http://g');
    });
    it('returns null when neither is set', () => {
      expect(model.prototype.avatarSrc.call({ localAvatarPath: null, avatarUrl: null })).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. BlackbaudToken
// ---------------------------------------------------------------------------
describe('BlackbaudToken Model', () => {
  let mockDefine, model;
  beforeEach(() => {
    jest.resetModules();
    ({ mockDefine, model } = loadModel('blackbaudToken'));
  });

  it('should define the model with correct name and table name', () => {
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'BlackbaudToken',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        accessToken: expect.objectContaining({ field: 'access_token', allowNull: false }),
        refreshToken: expect.objectContaining({ field: 'refresh_token', allowNull: false }),
        expiresAt: expect.objectContaining({ field: 'expires_at', allowNull: false }),
      }),
      expect.objectContaining({ tableName: 'blackbaud_tokens' }),
    );
  });

  describe('isExpired()', () => {
    it('returns true when expiresAt is in the past', () => {
      const past = new Date(Date.now() - 60000);
      expect(model.prototype.isExpired.call({ expiresAt: past })).toBe(true);
    });
    it('returns false when expiresAt is in the future', () => {
      const future = new Date(Date.now() + 60000);
      expect(model.prototype.isExpired.call({ expiresAt: future })).toBe(false);
    });
  });

  describe('expiresInMinutes()', () => {
    it('returns approximate minutes until expiry', () => {
      const future = new Date(Date.now() + 10 * 60000);
      const result = model.prototype.expiresInMinutes.call({ expiresAt: future });
      expect(result).toBeGreaterThanOrEqual(9);
      expect(result).toBeLessThanOrEqual(10);
    });
    it('returns 0 when already expired', () => {
      const past = new Date(Date.now() - 60000);
      expect(model.prototype.expiresInMinutes.call({ expiresAt: past })).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Conversation
// ---------------------------------------------------------------------------
describe('Conversation Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('conversation');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'Conversation',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        userId: expect.objectContaining({ field: 'user_id', allowNull: false }),
        title: expect.objectContaining({ allowNull: false }),
        messages: expect.objectContaining({ defaultValue: [] }),
      }),
      expect.objectContaining({ tableName: 'conversations' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. CrmGift
// ---------------------------------------------------------------------------
describe('CrmGift Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('crmGift');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'CrmGift',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        giftId: expect.objectContaining({ field: 'gift_id', allowNull: false }),
        giftAmount: expect.objectContaining({ field: 'gift_amount' }),
        giftDate: expect.objectContaining({ field: 'gift_date' }),
        constituentId: expect.objectContaining({ field: 'constituent_id' }),
        firstName: expect.objectContaining({ field: 'first_name' }),
        lastName: expect.objectContaining({ field: 'last_name' }),
        department: expect.any(Object),
      }),
      expect.objectContaining({ tableName: 'crm_gifts' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. CrmGiftFundraiser
// ---------------------------------------------------------------------------
describe('CrmGiftFundraiser Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('crmGiftFundraiser');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'CrmGiftFundraiser',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        giftId: expect.objectContaining({ field: 'gift_id', allowNull: false }),
        fundraiserName: expect.objectContaining({ field: 'fundraiser_name' }),
      }),
      expect.objectContaining({ tableName: 'crm_gift_fundraisers' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 6. CrmGiftMatch
// ---------------------------------------------------------------------------
describe('CrmGiftMatch Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('crmGiftMatch');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'CrmGiftMatch',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        giftId: expect.objectContaining({ field: 'gift_id', allowNull: false }),
        matchGiftId: expect.objectContaining({ field: 'match_gift_id' }),
      }),
      expect.objectContaining({ tableName: 'crm_gift_matches' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. CrmGiftSoftCredit
// ---------------------------------------------------------------------------
describe('CrmGiftSoftCredit Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('crmGiftSoftCredit');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'CrmGiftSoftCredit',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        giftId: expect.objectContaining({ field: 'gift_id', allowNull: false }),
        softCreditAmount: expect.objectContaining({ field: 'soft_credit_amount' }),
      }),
      expect.objectContaining({ tableName: 'crm_gift_soft_credits' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. CrmImport
// ---------------------------------------------------------------------------
describe('CrmImport Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('crmImport');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'CrmImport',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        status: expect.objectContaining({ defaultValue: 'processing' }),
        totalRows: expect.objectContaining({ field: 'total_rows' }),
        giftsUpserted: expect.objectContaining({ field: 'gifts_upserted', defaultValue: 0 }),
      }),
      expect.objectContaining({ tableName: 'crm_imports' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. DepartmentGoal
// ---------------------------------------------------------------------------
describe('DepartmentGoal Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('departmentGoal');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'DepartmentGoal',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        department: expect.objectContaining({ allowNull: false }),
        fiscalYear: expect.objectContaining({ field: 'fiscal_year', allowNull: false }),
        goalAmount: expect.objectContaining({ field: 'goal_amount', allowNull: false }),
      }),
      expect.objectContaining({ tableName: 'department_goals' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 10. DepartmentSummary
// ---------------------------------------------------------------------------
describe('DepartmentSummary Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('departmentSummary');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'DepartmentSummary',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        snapshotId: expect.objectContaining({ field: 'snapshot_id', allowNull: false }),
        department: expect.objectContaining({ allowNull: false }),
        totalGifts: expect.objectContaining({ field: 'total_gifts' }),
        totalAmount: expect.objectContaining({ field: 'total_amount' }),
      }),
      expect.objectContaining({ tableName: 'department_summaries' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 11. FundBreakdown
// ---------------------------------------------------------------------------
describe('FundBreakdown Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('fundBreakdown');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'FundBreakdown',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        snapshotId: expect.objectContaining({ field: 'snapshot_id', allowNull: false }),
        department: expect.objectContaining({ allowNull: false }),
        fundName: expect.objectContaining({ field: 'fund_name', allowNull: false }),
        amount: expect.any(Object),
      }),
      expect.objectContaining({ tableName: 'fund_breakdowns' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 12. FundraiserGoal
// ---------------------------------------------------------------------------
describe('FundraiserGoal Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('fundraiserGoal');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'FundraiserGoal',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        fundraiserName: expect.objectContaining({ field: 'fundraiser_name', allowNull: false }),
        fiscalYear: expect.objectContaining({ field: 'fiscal_year', allowNull: false }),
        goalAmount: expect.objectContaining({ field: 'goal_amount', allowNull: false }),
      }),
      expect.objectContaining({ tableName: 'fundraiser_goals' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 13. GiftTypeBreakdown
// ---------------------------------------------------------------------------
describe('GiftTypeBreakdown Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('giftTypeBreakdown');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'GiftTypeBreakdown',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        snapshotId: expect.objectContaining({ field: 'snapshot_id', allowNull: false }),
        department: expect.objectContaining({ allowNull: false }),
        giftType: expect.objectContaining({ field: 'gift_type', allowNull: false }),
        amount: expect.any(Object),
      }),
      expect.objectContaining({ tableName: 'gift_type_breakdowns' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 14. Kudos
// ---------------------------------------------------------------------------
describe('Kudos Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('kudos');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'Kudos',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        fromUserId: expect.objectContaining({ field: 'from_user_id', allowNull: false }),
        toUserId: expect.objectContaining({ field: 'to_user_id', allowNull: false }),
        message: expect.objectContaining({ allowNull: false }),
        category: expect.objectContaining({ defaultValue: 'general' }),
      }),
      expect.objectContaining({ tableName: 'kudos' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 15. Milestone
// ---------------------------------------------------------------------------
describe('Milestone Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('milestone');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'Milestone',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        title: expect.objectContaining({ allowNull: false }),
        milestoneType: expect.objectContaining({ field: 'milestone_type', defaultValue: 'amount' }),
        targetValue: expect.objectContaining({ field: 'target_value' }),
      }),
      expect.objectContaining({ tableName: 'milestones' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 16. Post
// ---------------------------------------------------------------------------
describe('Post Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('post');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'Post',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        authorId: expect.objectContaining({ field: 'author_id', allowNull: false }),
        title: expect.objectContaining({ allowNull: false }),
        body: expect.objectContaining({ allowNull: false }),
        category: expect.objectContaining({ defaultValue: 'General' }),
        pinned: expect.objectContaining({ defaultValue: false }),
      }),
      expect.objectContaining({ tableName: 'posts' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 17. PostComment
// ---------------------------------------------------------------------------
describe('PostComment Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('postComment');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'PostComment',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        postId: expect.objectContaining({ field: 'post_id', allowNull: false }),
        authorId: expect.objectContaining({ field: 'author_id', allowNull: false }),
        body: expect.objectContaining({ allowNull: false }),
      }),
      expect.objectContaining({ tableName: 'post_comments' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 18. QuickNote
// ---------------------------------------------------------------------------
describe('QuickNote Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('quickNote');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'QuickNote',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        userId: expect.objectContaining({ field: 'user_id', allowNull: false }),
        tenantId: expect.objectContaining({ field: 'tenant_id', allowNull: false }),
        content: expect.objectContaining({ allowNull: false, defaultValue: '' }),
        color: expect.objectContaining({ defaultValue: 'yellow' }),
      }),
      expect.objectContaining({ tableName: 'quick_notes' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 19. RawGift
// ---------------------------------------------------------------------------
describe('RawGift Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('rawGift');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'RawGift',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        snapshotId: expect.objectContaining({ field: 'snapshot_id', allowNull: false }),
        department: expect.objectContaining({ allowNull: false }),
        splitAmount: expect.objectContaining({ field: 'split_amount' }),
        giftDate: expect.objectContaining({ field: 'gift_date' }),
      }),
      expect.objectContaining({ tableName: 'raw_gifts' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 20. Snapshot
// ---------------------------------------------------------------------------
describe('Snapshot Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('snapshot');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'Snapshot',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        tenantId: expect.objectContaining({ field: 'tenant_id' }),
        snapshotDate: expect.objectContaining({ field: 'snapshot_date', allowNull: false }),
        uploadedBy: expect.objectContaining({ field: 'uploaded_by' }),
      }),
      expect.objectContaining({ tableName: 'snapshots' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 21. SourceBreakdown
// ---------------------------------------------------------------------------
describe('SourceBreakdown Model', () => {
  it('should define the model with correct name and table name', () => {
    jest.resetModules();
    const { mockDefine } = loadModel('sourceBreakdown');
    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'SourceBreakdown',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        snapshotId: expect.objectContaining({ field: 'snapshot_id', allowNull: false }),
        department: expect.objectContaining({ allowNull: false }),
        source: expect.objectContaining({ allowNull: false }),
        amount: expect.any(Object),
      }),
      expect.objectContaining({ tableName: 'source_breakdowns' }),
    );
  });
});
