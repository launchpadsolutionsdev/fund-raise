'use strict';

/**
 * Move CRM index creation, department backfill, and materialized view
 * creation out of app.js startup and into a migration.
 *
 * This runs once during `npm run migrate` (build step) instead of
 * blocking every server restart. All statements are idempotent.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const seq = queryInterface.sequelize;

    // ── 1. CRM Indexes ──────────────────────────────────────────────
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_constituent ON crm_gifts(tenant_id, constituent_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_date ON crm_gifts(tenant_id, gift_date)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_fund ON crm_gifts(tenant_id, fund_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_campaign ON crm_gifts(tenant_id, campaign_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_appeal ON crm_gifts(tenant_id, appeal_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_giftid ON crm_gifts(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_fundraisers_tenant_giftid ON crm_gift_fundraisers(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_fundraisers_tenant_name ON crm_gift_fundraisers(tenant_id, fundraiser_name)',
      'CREATE INDEX IF NOT EXISTS idx_crm_softcredits_tenant_giftid ON crm_gift_soft_credits(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_matches_tenant_giftid ON crm_gift_matches(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_dept_date ON crm_gifts(tenant_id, department, gift_date) INCLUDE (gift_amount, constituent_id)',
      'CREATE INDEX IF NOT EXISTS idx_actions_tenant_assignedto_status ON actions(tenant_id, assigned_to_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_actions_tenant_assignedby_status ON actions(tenant_id, assigned_by_id, status)',
    ];
    for (const sql of indexes) {
      try { await seq.query(sql); } catch (e) { /* table may not exist yet */ }
    }
    console.log('[Migration] CRM indexes ensured.');

    // ── 2. Department Backfill ───────────────────────────────────────
    try {
      const [rows] = await seq.query(
        `SELECT COUNT(*) as cnt FROM crm_gifts WHERE department IS NULL`
      );
      const cnt = Number(rows[0].cnt);
      if (cnt > 0) {
        console.log(`[Migration] Backfilling department for ${cnt} rows...`);
        await seq.query(`
          UPDATE crm_gifts SET department = CASE
            WHEN LOWER(COALESCE(appeal_category,'')) ~* '(legacy|planned|bequest|estate|endow)' THEN 'Legacy Giving'
            WHEN LOWER(COALESCE(fund_category,'')) ~* '(legacy|planned|bequest|estate|endow)' THEN 'Legacy Giving'
            WHEN LOWER(COALESCE(appeal_category,'')) ~* '(event|gala|dinner|auction|golf|benefit|tournament|luncheon|concert|festival|walk|run|5k|10k|marathon|reception)' THEN 'Events'
            WHEN LOWER(COALESCE(fund_category,'')) ~* '(event|gala|dinner|auction|golf|benefit|tournament)' THEN 'Events'
            WHEN LOWER(COALESCE(appeal_category,'')) ~* '(major|leadership|principal|capital|transform)' THEN 'Major Gifts'
            WHEN LOWER(COALESCE(fund_category,'')) ~* '(major|capital)' THEN 'Major Gifts'
            WHEN LOWER(COALESCE(appeal_category,'')) ~* '(mail|dm|solicitation|postal|letter)' THEN 'Direct Mail'
            WHEN LOWER(COALESCE(appeal_category,'')) ~* '(annual|giving|phonathon|fund.?drive|unrestrict)' THEN 'Annual Giving'
            WHEN LOWER(COALESCE(gift_code,'')) ~* '(bequest|trust|annuity|estate|ira|legacy|planned)' THEN 'Legacy Giving'
            WHEN LOWER(COALESCE(gift_code,'')) ~* '(event|registration|sponsorship|ticket|auction|table|gala)' THEN 'Events'
            WHEN LOWER(COALESCE(gift_code,'')) ~* '(major.?gift|pledge|principal)' THEN 'Major Gifts'
            WHEN LOWER(COALESCE(appeal_description,'') || ' ' || COALESCE(campaign_description,'')) ~* '(legacy|planned.?gift|bequest|estate|endow|charitable.?remainder|charitable.?trust|gift.?annuit)' THEN 'Legacy Giving'
            WHEN LOWER(COALESCE(appeal_description,'') || ' ' || COALESCE(campaign_description,'')) ~* '(gala|dinner|golf|auction|benefit|ball|luncheon|walk|run|5k|10k|marathon|reception|concert|festival|tournament|trivia|taste|tasting|raffle)' THEN 'Events'
            WHEN LOWER(COALESCE(appeal_description,'') || ' ' || COALESCE(campaign_description,'')) ~* '(major|leadership|principal|capital|transform|campaign.?cabinet)' THEN 'Major Gifts'
            WHEN LOWER(COALESCE(appeal_description,'') || ' ' || COALESCE(campaign_description,'')) ~* '(mail|dm[0-9]|solicitation|letter|mailing|postal|postcard|brochure|newsletter|bulk)' THEN 'Direct Mail'
            WHEN LOWER(COALESCE(appeal_description,'') || ' ' || COALESCE(campaign_description,'')) ~* '(annual|phonathon|giving.?day|fund.?drive|year.?end|eofy|eoy|spring|fall|holiday|christmas|appeal)' THEN 'Annual Giving'
            WHEN LOWER(COALESCE(fund_description,'')) ~* '(endowment|legacy|planned|bequest)' THEN 'Legacy Giving'
            WHEN LOWER(COALESCE(fund_description,'')) ~* '(event|gala|auction|benefit|dinner|golf|sponsorship)' THEN 'Events'
            WHEN LOWER(COALESCE(fund_description,'')) ~* '(capital|major|transform|building)' THEN 'Major Gifts'
            WHEN gift_amount >= 10000 THEN 'Major Gifts'
            ELSE 'Annual Giving'
          END
          WHERE department IS NULL
        `);
        console.log('[Migration] Department backfill complete.');
      } else {
        console.log('[Migration] No department backfill needed.');
      }
    } catch (e) {
      console.log('[Migration] Skipping department backfill (table may not exist yet).');
    }

    // ── 3. Materialized Views ────────────────────────────────────────
    // Replicates createMaterializedViews() from crmMaterializedViews.js
    // so it runs at build time, not app startup.

    try {
      // 3.1 Gift-level view with fiscal year
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_gift_fy AS
        SELECT
          id, tenant_id, gift_id, gift_amount, gift_code, gift_date,
          constituent_id, first_name, last_name,
          fund_id, fund_description,
          campaign_id, campaign_description,
          appeal_id, appeal_description,
          gift_acknowledge, gift_acknowledge_date,
          CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
               THEN EXTRACT(YEAR FROM gift_date) + 1
               ELSE EXTRACT(YEAR FROM gift_date)
          END AS fiscal_year
        FROM crm_gifts
        WHERE gift_date IS NOT NULL
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_gift_fy_id ON mv_crm_gift_fy (id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant ON mv_crm_gift_fy (tenant_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_fy ON mv_crm_gift_fy (tenant_id, fiscal_year)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_const ON mv_crm_gift_fy (tenant_id, constituent_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_fund ON mv_crm_gift_fy (tenant_id, fund_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_campaign ON mv_crm_gift_fy (tenant_id, campaign_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_appeal ON mv_crm_gift_fy (tenant_id, appeal_id)`);

      // 3.2 Per-FY overview
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fy_overview AS
        SELECT tenant_id, fiscal_year,
          COUNT(*) as total_gifts, COALESCE(SUM(gift_amount),0) as total_raised,
          COALESCE(AVG(gift_amount),0) as avg_gift, COALESCE(MAX(gift_amount),0) as largest_gift,
          MIN(gift_date) as earliest_date, MAX(gift_date) as latest_date,
          COUNT(DISTINCT constituent_id) as unique_donors, COUNT(DISTINCT fund_id) as unique_funds,
          COUNT(DISTINCT campaign_id) as unique_campaigns, COUNT(DISTINCT appeal_id) as unique_appeals
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fy_overview_pk ON mv_crm_fy_overview (tenant_id, fiscal_year)`);

      // 3.3 All-time overview
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_alltime_overview AS
        SELECT tenant_id,
          COUNT(*) as total_gifts, COALESCE(SUM(gift_amount),0) as total_raised,
          COALESCE(AVG(gift_amount),0) as avg_gift, COALESCE(MAX(gift_amount),0) as largest_gift,
          MIN(gift_date) as earliest_date, MAX(gift_date) as latest_date,
          COUNT(DISTINCT constituent_id) as unique_donors, COUNT(DISTINCT fund_id) as unique_funds,
          COUNT(DISTINCT campaign_id) as unique_campaigns, COUNT(DISTINCT appeal_id) as unique_appeals
        FROM crm_gifts GROUP BY tenant_id
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_alltime_overview_pk ON mv_crm_alltime_overview (tenant_id)`);

      // 3.4 Giving by month
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_giving_by_month AS
        SELECT tenant_id, fiscal_year, TO_CHAR(gift_date, 'YYYY-MM') as month,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year, month
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_giving_by_month_pk ON mv_crm_giving_by_month (tenant_id, fiscal_year, month)`);

      // 3.5 Donor totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_donor_totals AS
        SELECT tenant_id, fiscal_year, constituent_id, first_name, last_name,
          COUNT(*) as gift_count, SUM(gift_amount) as total, MAX(gift_date) as last_gift_date
        FROM mv_crm_gift_fy WHERE last_name IS NOT NULL
        GROUP BY tenant_id, fiscal_year, constituent_id, first_name, last_name
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_donor_totals_pk ON mv_crm_donor_totals (tenant_id, fiscal_year, constituent_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_donor_totals_sort ON mv_crm_donor_totals (tenant_id, fiscal_year, total DESC)`);

      // 3.6 Fund totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fund_totals AS
        SELECT tenant_id, fiscal_year, fund_id, fund_description,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy WHERE fund_description IS NOT NULL
        GROUP BY tenant_id, fiscal_year, fund_id, fund_description
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fund_totals_pk ON mv_crm_fund_totals (tenant_id, fiscal_year, fund_id)`);

      // 3.7 Campaign totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_campaign_totals AS
        SELECT tenant_id, fiscal_year, campaign_id, campaign_description,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy WHERE campaign_description IS NOT NULL
        GROUP BY tenant_id, fiscal_year, campaign_id, campaign_description
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_campaign_totals_pk ON mv_crm_campaign_totals (tenant_id, fiscal_year, campaign_id)`);

      // 3.8 Appeal totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_appeal_totals AS
        SELECT tenant_id, fiscal_year, appeal_id, appeal_description,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy WHERE appeal_description IS NOT NULL
        GROUP BY tenant_id, fiscal_year, appeal_id, appeal_description
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_appeal_totals_pk ON mv_crm_appeal_totals (tenant_id, fiscal_year, appeal_id)`);

      // 3.9 Gift types
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_gift_types AS
        SELECT tenant_id, fiscal_year, COALESCE(gift_code, 'Unknown') as gift_type,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year, gift_type
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_gift_types_pk ON mv_crm_gift_types (tenant_id, fiscal_year, gift_type)`);

      // 3.10 Fundraiser totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fundraiser_totals AS
        SELECT f.tenant_id,
          CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
               THEN EXTRACT(YEAR FROM g.gift_date) + 1
               ELSE EXTRACT(YEAR FROM g.gift_date)
          END AS fiscal_year,
          f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name,
          COUNT(DISTINCT f.gift_id) as gift_count, COUNT(DISTINCT g.constituent_id) as donor_count,
          SUM(f.fundraiser_amount) as total_credited, SUM(g.gift_amount) as total_gift_amount,
          MIN(g.gift_date) as earliest_gift, MAX(g.gift_date) as latest_gift
        FROM crm_gift_fundraisers f
        JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
        WHERE f.fundraiser_name IS NOT NULL AND g.gift_date IS NOT NULL
        GROUP BY f.tenant_id, fiscal_year, f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fundraiser_totals_pk ON mv_crm_fundraiser_totals (tenant_id, fiscal_year, fundraiser_name)`);

      // 3.11 Fiscal years summary
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fiscal_years AS
        SELECT tenant_id, fiscal_year as fy, COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year ORDER BY fiscal_year DESC
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fiscal_years_pk ON mv_crm_fiscal_years (tenant_id, fy)`);

      console.log('[Migration] Materialized views ensured.');
    } catch (e) {
      console.log('[Migration] Skipping materialized views (CRM tables may not exist yet):', e.message);
    }
  },

  async down(queryInterface) {
    // Indexes are harmless to leave; MVs have their own drop function.
    // This down migration is intentionally minimal.
    const seq = queryInterface.sequelize;
    const mvs = [
      'mv_crm_fiscal_years', 'mv_crm_fundraiser_totals', 'mv_crm_gift_types',
      'mv_crm_appeal_totals', 'mv_crm_campaign_totals', 'mv_crm_fund_totals',
      'mv_crm_donor_totals', 'mv_crm_giving_by_month', 'mv_crm_alltime_overview',
      'mv_crm_fy_overview', 'mv_crm_gift_fy',
    ];
    for (const mv of mvs) {
      await seq.query(`DROP MATERIALIZED VIEW IF EXISTS ${mv} CASCADE`);
    }
  },
};
