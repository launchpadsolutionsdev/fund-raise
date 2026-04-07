'use strict';

/**
 * Baseline migration — captures the current schema state of all 25 models.
 *
 * DO NOT run this against an existing database that already has these tables.
 * This exists as a reference point so future migrations have a known starting state.
 *
 * For a fresh database, run: npx sequelize-cli db:migrate
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    // ---- tenants ----
    await queryInterface.createTable('tenants', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      slug: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      logo_path: { type: DataTypes.STRING(255), allowNull: true },
      mission_statement: { type: DataTypes.TEXT, allowNull: true },
      address_line1: { type: DataTypes.STRING(255), allowNull: true },
      address_line2: { type: DataTypes.STRING(255), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      state: { type: DataTypes.STRING(50), allowNull: true },
      zip: { type: DataTypes.STRING(20), allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },
      ein: { type: DataTypes.STRING(20), allowNull: true },
      fiscal_year_start: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 4 },
      onboarding_completed: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
      onboarding_step: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
      "createdAt": { type: DataTypes.DATE, allowNull: true },
    });

    // ---- users ----
    await queryInterface.createTable('users', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, references: { model: 'tenants', key: 'id' } },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(255) },
      google_id: { type: DataTypes.STRING(255), unique: true },
      avatar_url: { type: DataTypes.TEXT },
      role: { type: DataTypes.STRING(50), defaultValue: 'viewer' },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      last_login: { type: DataTypes.DATE },
      nickname: { type: DataTypes.STRING(100), allowNull: true },
      job_title: { type: DataTypes.STRING(150), allowNull: true },
      bio: { type: DataTypes.TEXT, allowNull: true },
      local_avatar_path: { type: DataTypes.STRING(255), allowNull: true },
      "createdAt": { type: DataTypes.DATE, allowNull: true },
    });

    // ---- snapshots ----
    await queryInterface.createTable('snapshots', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, references: { model: 'tenants', key: 'id' } },
      snapshot_date: { type: DataTypes.DATEONLY, allowNull: false },
      uploaded_by: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
      uploaded_at: { type: DataTypes.DATE, defaultValue: Sequelize.literal('NOW()') },
      notes: { type: DataTypes.TEXT },
    });
    await queryInterface.addIndex('snapshots', ['tenant_id', 'snapshot_date'], { unique: true });

    // ---- department_summaries ----
    await queryInterface.createTable('department_summaries', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      snapshot_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'snapshots', key: 'id' }, onDelete: 'CASCADE' },
      department: { type: DataTypes.STRING(50), allowNull: false },
      total_gifts: { type: DataTypes.INTEGER },
      total_amount: { type: DataTypes.DECIMAL(12, 2) },
      goal: { type: DataTypes.DECIMAL(12, 2) },
      pct_to_goal: { type: DataTypes.DECIMAL(12, 6) },
      avg_gift: { type: DataTypes.DECIMAL(12, 2) },
      new_expectancies: { type: DataTypes.INTEGER },
      open_estates: { type: DataTypes.INTEGER },
      recorded_expectancies: { type: DataTypes.INTEGER },
      third_party_total_gifts: { type: DataTypes.INTEGER },
      third_party_total_amount: { type: DataTypes.DECIMAL(12, 2) },
      third_party_goal: { type: DataTypes.DECIMAL(12, 2) },
      third_party_pct_to_goal: { type: DataTypes.DECIMAL(12, 6) },
    });

    // ---- gift_type_breakdowns ----
    await queryInterface.createTable('gift_type_breakdowns', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      snapshot_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'snapshots', key: 'id' }, onDelete: 'CASCADE' },
      department: { type: DataTypes.STRING(50), allowNull: false },
      gift_type: { type: DataTypes.STRING(100), allowNull: false },
      amount: { type: DataTypes.INTEGER },
      pct_of_gifts: { type: DataTypes.DECIMAL(12, 6) },
    });

    // ---- source_breakdowns ----
    await queryInterface.createTable('source_breakdowns', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      snapshot_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'snapshots', key: 'id' }, onDelete: 'CASCADE' },
      department: { type: DataTypes.STRING(50), allowNull: false },
      source: { type: DataTypes.STRING(100), allowNull: false },
      amount: { type: DataTypes.INTEGER },
      pct_of_gifts: { type: DataTypes.DECIMAL(12, 6) },
    });

    // ---- fund_breakdowns ----
    await queryInterface.createTable('fund_breakdowns', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      snapshot_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'snapshots', key: 'id' }, onDelete: 'CASCADE' },
      department: { type: DataTypes.STRING(50), allowNull: false },
      category: { type: DataTypes.STRING(50), defaultValue: 'primary' },
      fund_name: { type: DataTypes.STRING(255), allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2) },
      pct_of_total: { type: DataTypes.DECIMAL(12, 6) },
      onetime_count: { type: DataTypes.INTEGER },
      recurring_count: { type: DataTypes.INTEGER },
      online_count: { type: DataTypes.INTEGER },
      mailed_in_count: { type: DataTypes.INTEGER },
      total_count: { type: DataTypes.INTEGER },
    });

    // ---- raw_gifts ----
    await queryInterface.createTable('raw_gifts', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      snapshot_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'snapshots', key: 'id' }, onDelete: 'CASCADE' },
      department: { type: DataTypes.STRING(50), allowNull: false },
      primary_addressee: { type: DataTypes.STRING(255) },
      appeal_id: { type: DataTypes.STRING(255) },
      split_amount: { type: DataTypes.DECIMAL(12, 2) },
      fund_description: { type: DataTypes.STRING(255) },
      gift_id: { type: DataTypes.INTEGER },
      gift_type: { type: DataTypes.STRING(100) },
      gift_reference: { type: DataTypes.STRING(255) },
      gift_date: { type: DataTypes.DATEONLY },
      extra_field: { type: DataTypes.STRING(255) },
    });

    // ---- crm_gifts ----
    await queryInterface.createTable('crm_gifts', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      gift_id: { type: DataTypes.STRING(50), allowNull: false },
      gift_amount: { type: DataTypes.DECIMAL(14, 2) },
      gift_code: { type: DataTypes.STRING(100) },
      gift_date: { type: DataTypes.DATEONLY },
      gift_status: { type: DataTypes.STRING(50) },
      gift_payment_type: { type: DataTypes.STRING(100) },
      gift_acknowledge: { type: DataTypes.STRING(100) },
      gift_acknowledge_date: { type: DataTypes.DATEONLY },
      gift_receipt_amount: { type: DataTypes.DECIMAL(14, 2) },
      gift_batch_number: { type: DataTypes.STRING(100) },
      gift_date_added: { type: DataTypes.DATEONLY },
      gift_date_last_changed: { type: DataTypes.DATEONLY },
      gift_type: { type: DataTypes.STRING(100) },
      gift_reference: { type: DataTypes.STRING(255) },
      payment_type: { type: DataTypes.STRING(100) },
      system_record_id: { type: DataTypes.STRING(50) },
      constituent_id: { type: DataTypes.STRING(50) },
      first_name: { type: DataTypes.STRING(255) },
      last_name: { type: DataTypes.STRING(255) },
      constituent_email: { type: DataTypes.STRING(255) },
      constituent_phone: { type: DataTypes.STRING(50) },
      constituent_address: { type: DataTypes.STRING(500) },
      constituent_city: { type: DataTypes.STRING(255) },
      constituent_state: { type: DataTypes.STRING(100) },
      constituent_zip: { type: DataTypes.STRING(20) },
      constituent_country: { type: DataTypes.STRING(100) },
      address_type: { type: DataTypes.STRING(100) },
      address_do_not_mail: { type: DataTypes.BOOLEAN },
      phone_type: { type: DataTypes.STRING(100) },
      phone_do_not_call: { type: DataTypes.BOOLEAN },
      email_type: { type: DataTypes.STRING(100) },
      email_do_not_email: { type: DataTypes.BOOLEAN },
      constituent_lookup_id: { type: DataTypes.STRING(100) },
      constituent_name: { type: DataTypes.STRING(500) },
      primary_addressee: { type: DataTypes.STRING(500) },
      constituent_code: { type: DataTypes.STRING(255) },
      constituent_type: { type: DataTypes.STRING(100) },
      solicit_code: { type: DataTypes.STRING(255) },
      fund_category: { type: DataTypes.STRING(255) },
      fund_description: { type: DataTypes.STRING(500) },
      fund_id: { type: DataTypes.STRING(50) },
      fund_notes: { type: DataTypes.TEXT },
      campaign_id: { type: DataTypes.STRING(50) },
      campaign_description: { type: DataTypes.STRING(500) },
      campaign_notes: { type: DataTypes.TEXT },
      campaign_start_date: { type: DataTypes.DATEONLY },
      campaign_end_date: { type: DataTypes.DATEONLY },
      campaign_category: { type: DataTypes.STRING(255) },
      appeal_category: { type: DataTypes.STRING(255) },
      appeal_description: { type: DataTypes.STRING(500) },
      appeal_id: { type: DataTypes.STRING(50) },
      appeal_notes: { type: DataTypes.TEXT },
      appeal_start_date: { type: DataTypes.DATEONLY },
      appeal_end_date: { type: DataTypes.DATEONLY },
      package_description: { type: DataTypes.STRING(500) },
      package_id: { type: DataTypes.STRING(50) },
      department: { type: DataTypes.STRING(50) },
    });
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'gift_id']);
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'constituent_id']);
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'gift_date']);
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'fund_id']);
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'campaign_id']);
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'appeal_id']);
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'gift_code']);
    await queryInterface.addIndex('crm_gifts', ['tenant_id', 'last_name']);

    // ---- crm_gift_fundraisers ----
    await queryInterface.createTable('crm_gift_fundraisers', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false },
      gift_id: { type: DataTypes.STRING(50), allowNull: false },
      fundraiser_name: { type: DataTypes.STRING(255) },
      fundraiser_first_name: { type: DataTypes.STRING(255) },
      fundraiser_last_name: { type: DataTypes.STRING(255) },
      fundraiser_amount: { type: DataTypes.DECIMAL(14, 2) },
    });
    await queryInterface.addIndex('crm_gift_fundraisers', ['tenant_id', 'gift_id', 'fundraiser_name']);
    await queryInterface.addIndex('crm_gift_fundraisers', ['tenant_id', 'fundraiser_name']);
    await queryInterface.addIndex('crm_gift_fundraisers', ['tenant_id', 'fundraiser_last_name']);

    // ---- crm_gift_soft_credits ----
    await queryInterface.createTable('crm_gift_soft_credits', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false },
      gift_id: { type: DataTypes.STRING(50), allowNull: false },
      soft_credit_amount: { type: DataTypes.DECIMAL(14, 2) },
      recipient_first_name: { type: DataTypes.STRING(255) },
      recipient_id: { type: DataTypes.STRING(50) },
      recipient_last_name: { type: DataTypes.STRING(255) },
      recipient_name: { type: DataTypes.STRING(255) },
    });
    await queryInterface.addIndex('crm_gift_soft_credits', ['tenant_id', 'gift_id', 'recipient_id']);
    await queryInterface.addIndex('crm_gift_soft_credits', ['tenant_id', 'recipient_id']);
    await queryInterface.addIndex('crm_gift_soft_credits', ['tenant_id', 'recipient_name']);

    // ---- crm_gift_matches ----
    await queryInterface.createTable('crm_gift_matches', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false },
      gift_id: { type: DataTypes.STRING(50), allowNull: false },
      match_gift_id: { type: DataTypes.STRING(50) },
      match_gift_code: { type: DataTypes.STRING(100) },
      match_gift_date: { type: DataTypes.DATEONLY },
      match_receipt_amount: { type: DataTypes.DECIMAL(14, 2) },
      match_receipt_date: { type: DataTypes.DATEONLY },
      match_acknowledge: { type: DataTypes.STRING(100) },
      match_acknowledge_date: { type: DataTypes.DATEONLY },
      match_constituent_code: { type: DataTypes.STRING(255) },
      match_is_anonymous: { type: DataTypes.BOOLEAN },
      match_added_by: { type: DataTypes.STRING(255) },
      match_date_added: { type: DataTypes.DATEONLY },
      match_date_last_changed: { type: DataTypes.DATEONLY },
    });
    await queryInterface.addIndex('crm_gift_matches', ['tenant_id', 'gift_id', 'match_gift_id']);
    await queryInterface.addIndex('crm_gift_matches', ['tenant_id', 'match_gift_id']);

    // ---- crm_imports ----
    await queryInterface.createTable('crm_imports', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      uploaded_by: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
      uploaded_at: { type: DataTypes.DATE, defaultValue: Sequelize.literal('NOW()') },
      file_name: { type: DataTypes.STRING(255) },
      file_size: { type: DataTypes.INTEGER },
      status: { type: DataTypes.ENUM('processing', 'completed', 'failed'), defaultValue: 'processing' },
      total_rows: { type: DataTypes.INTEGER },
      gifts_upserted: { type: DataTypes.INTEGER, defaultValue: 0 },
      fundraisers_upserted: { type: DataTypes.INTEGER, defaultValue: 0 },
      soft_credits_upserted: { type: DataTypes.INTEGER, defaultValue: 0 },
      matches_upserted: { type: DataTypes.INTEGER, defaultValue: 0 },
      error_message: { type: DataTypes.TEXT },
      completed_at: { type: DataTypes.DATE },
      column_mapping: { type: DataTypes.JSONB },
    });

    // ---- blackbaud_tokens ----
    await queryInterface.createTable('blackbaud_tokens', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      connected_by: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
      access_token: { type: DataTypes.TEXT, allowNull: false },
      refresh_token: { type: DataTypes.TEXT, allowNull: false },
      token_type: { type: DataTypes.STRING(50), defaultValue: 'Bearer' },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      environment_id: { type: DataTypes.STRING(255) },
      environment_name: { type: DataTypes.STRING(255) },
      connected_at: { type: DataTypes.DATE, defaultValue: Sequelize.literal('NOW()') },
      last_refreshed_at: { type: DataTypes.DATE },
    });

    // ---- conversations ----
    await queryInterface.createTable('conversations', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      title: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'New conversation' },
      messages: { type: DataTypes.JSONB, allowNull: false, defaultValue: '[]' },
      shared_with: { type: DataTypes.JSONB, allowNull: false, defaultValue: '[]' },
      is_renxt_session: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
    });

    // ---- posts ----
    await queryInterface.createTable('posts', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      author_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      title: { type: DataTypes.STRING(255), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      category: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'General' },
      pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
    });

    // ---- post_comments ----
    await queryInterface.createTable('post_comments', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      post_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'posts', key: 'id' }, onDelete: 'CASCADE' },
      author_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      body: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
    });

    // ---- milestones ----
    await queryInterface.createTable('milestones', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      milestone_type: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'amount' },
      target_value: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      department: { type: DataTypes.STRING(50), allowNull: true },
      reached: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reached_at: { type: DataTypes.DATE, allowNull: true },
      celebration_emoji: { type: DataTypes.STRING(10), allowNull: true, defaultValue: '🎉' },
      created_by_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
    });

    // ---- quick_notes ----
    await queryInterface.createTable('quick_notes', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      content: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      color: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'yellow' },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
    });

    // ---- kudos ----
    await queryInterface.createTable('kudos', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      from_user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      to_user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      message: { type: DataTypes.TEXT, allowNull: false },
      category: { type: DataTypes.STRING(30), defaultValue: 'general' },
      emoji: { type: DataTypes.STRING(10), defaultValue: '⭐' },
      reactions: { type: DataTypes.JSONB, defaultValue: '{}' },
      "createdAt": { type: DataTypes.DATE },
    });

    // ---- fundraiser_goals ----
    await queryInterface.createTable('fundraiser_goals', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      fundraiser_name: { type: DataTypes.STRING(500), allowNull: false },
      fiscal_year: { type: DataTypes.INTEGER, allowNull: false },
      goal_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      "createdAt": { type: DataTypes.DATE },
      "updatedAt": { type: DataTypes.DATE },
    });
    await queryInterface.addIndex('fundraiser_goals', ['tenant_id', 'fundraiser_name', 'fiscal_year'], { unique: true });

    // ---- department_goals ----
    await queryInterface.createTable('department_goals', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      department: { type: DataTypes.STRING(20), allowNull: false },
      fiscal_year: { type: DataTypes.INTEGER, allowNull: false },
      goal_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      "createdAt": { type: DataTypes.DATE },
      "updatedAt": { type: DataTypes.DATE },
    });
    await queryInterface.addIndex('department_goals', ['tenant_id', 'department', 'fiscal_year'], { unique: true });

    // ---- tenant_data_configs ----
    await queryInterface.createTable('tenant_data_configs', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, unique: true, references: { model: 'tenants', key: 'id' }, onDelete: 'CASCADE' },
      include_gift_core: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_constituent_contact: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_campaigns: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_appeals: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_funds: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_fundraiser_credits: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_soft_credits: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_matching_gifts: { type: DataTypes.BOOLEAN, defaultValue: true },
      include_constituent_codes: { type: DataTypes.BOOLEAN, defaultValue: true },
      fiscal_year_start_month: { type: DataTypes.INTEGER, defaultValue: 4 },
      detected_departments: { type: DataTypes.JSONB },
      department_classification_rules: { type: DataTypes.JSONB },
      onboarding_step: { type: DataTypes.INTEGER, defaultValue: 1 },
      onboarding_completed_at: { type: DataTypes.DATE },
      query_instructions: { type: DataTypes.JSONB },
      "createdAt": { type: DataTypes.DATE },
      "updatedAt": { type: DataTypes.DATE },
    });

    // ---- actions ----
    await queryInterface.createTable('actions', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tenants', key: 'id' } },
      assigned_by_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      assigned_to_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      constituent_name: { type: DataTypes.STRING(255), allowNull: true },
      constituent_id: { type: DataTypes.STRING(255), allowNull: true },
      system_record_id: { type: DataTypes.STRING(255), allowNull: true },
      donor_context: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.ENUM('open', 'pending', 'resolved'), allowNull: false, defaultValue: 'open' },
      priority: { type: DataTypes.ENUM('normal', 'high', 'urgent'), allowNull: false, defaultValue: 'normal' },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      resolved_by_id: { type: DataTypes.INTEGER, allowNull: true },
      last_viewed_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex('actions', ['tenant_id', 'assigned_to_id', 'status']);
    await queryInterface.addIndex('actions', ['tenant_id', 'assigned_by_id', 'status']);

    // ---- action_comments ----
    await queryInterface.createTable('action_comments', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      action_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'actions', key: 'id' }, onDelete: 'CASCADE' },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
      content: { type: DataTypes.TEXT, allowNull: false },
      is_system_comment: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
    });
  },

  async down(queryInterface) {
    // Drop in reverse dependency order
    const tables = [
      'action_comments', 'actions', 'tenant_data_configs', 'department_goals',
      'fundraiser_goals', 'kudos', 'quick_notes', 'milestones', 'post_comments',
      'posts', 'conversations', 'blackbaud_tokens', 'crm_imports', 'crm_gift_matches',
      'crm_gift_soft_credits', 'crm_gift_fundraisers', 'crm_gifts', 'raw_gifts',
      'fund_breakdowns', 'source_breakdowns', 'gift_type_breakdowns',
      'department_summaries', 'snapshots', 'users', 'tenants',
    ];
    for (const table of tables) {
      await queryInterface.dropTable(table, { cascade: true });
    }
  },
};
