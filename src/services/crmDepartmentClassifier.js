/**
 * Department Classification
 *
 * Mirrors the 5-tier heuristic previously computed in SQL (DEPT_CLASSIFY_SQL).
 * Now runs in JavaScript at import time so every row gets a pre-computed
 * `department` column — eliminating expensive regex from query time.
 *
 * Priority order:
 *   1. appeal_category / fund_category (highest trust)
 *   2. gift_code
 *   3. appeal_description + campaign_description
 *   4. fund_description
 *   5. gift_amount threshold (≥$10K → Major Gifts)
 *   Default: Annual Giving
 */
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

// Pre-compiled regex patterns for each signal tier
const LEGACY  = /legacy|planned|bequest|estate|endow/i;
const EVENTS  = /event|gala|dinner|auction|golf|benefit|tournament|luncheon|concert|festival|walk|run|5k|10k|marathon|reception/i;
const MAJOR   = /major|leadership|principal|capital|transform/i;
const MAIL    = /mail|dm|solicitation|postal|letter/i;
const ANNUAL  = /annual|giving|phonathon|fund.?drive|unrestrict/i;

const LEGACY_CODE  = /bequest|trust|annuity|estate|ira|legacy|planned/i;
const EVENTS_CODE  = /event|registration|sponsorship|ticket|auction|table|gala/i;
const MAJOR_CODE   = /major.?gift|pledge|principal/i;

const LEGACY_DESC  = /legacy|planned.?gift|bequest|estate|endow|charitable.?remainder|charitable.?trust|gift.?annuit/i;
const EVENTS_DESC  = /gala|dinner|golf|auction|benefit|ball|luncheon|walk|run|5k|10k|marathon|reception|concert|festival|tournament|trivia|taste|tasting|raffle/i;
const MAJOR_DESC   = /major|leadership|principal|capital|transform|campaign.?cabinet/i;
const MAIL_DESC    = /mail|dm[0-9]|solicitation|letter|mailing|postal|postcard|brochure|newsletter|bulk/i;
const ANNUAL_DESC  = /annual|phonathon|giving.?day|fund.?drive|year.?end|eofy|eoy|spring|fall|holiday|christmas|appeal/i;

const LEGACY_FUND  = /endowment|legacy|planned|bequest/i;
const EVENTS_FUND  = /event|gala|auction|benefit|dinner|golf|sponsorship/i;
const MAJOR_FUND   = /capital|major|transform|building/i;

/**
 * Classify a single gift row into a department.
 * Accepts an object with the raw CRM fields.
 */
function classifyDepartment(row) {
  const ac = row.appealCategory || row.appeal_category || '';
  const fc = row.fundCategory || row.fund_category || '';
  const gc = row.giftCode || row.gift_code || '';
  const ad = row.appealDescription || row.appeal_description || '';
  const cd = row.campaignDescription || row.campaign_description || '';
  const fd = row.fundDescription || row.fund_description || '';
  const amt = Number(row.giftAmount || row.gift_amount) || 0;

  // Signal 1: category fields
  if (LEGACY.test(ac) || LEGACY.test(fc)) return 'Legacy Giving';
  if (EVENTS.test(ac) || EVENTS.test(fc)) return 'Events';
  if (MAJOR.test(ac) || MAJOR.test(fc)) return 'Major Gifts';
  if (MAIL.test(ac)) return 'Direct Mail';
  if (ANNUAL.test(ac)) return 'Annual Giving';

  // Signal 2: gift_code
  if (LEGACY_CODE.test(gc)) return 'Legacy Giving';
  if (EVENTS_CODE.test(gc)) return 'Events';
  if (MAJOR_CODE.test(gc)) return 'Major Gifts';

  // Signal 3: appeal + campaign descriptions
  const combo = ad + ' ' + cd;
  if (LEGACY_DESC.test(combo)) return 'Legacy Giving';
  if (EVENTS_DESC.test(combo)) return 'Events';
  if (MAJOR_DESC.test(combo)) return 'Major Gifts';
  if (MAIL_DESC.test(combo)) return 'Direct Mail';
  if (ANNUAL_DESC.test(combo)) return 'Annual Giving';

  // Signal 4: fund_description
  if (LEGACY_FUND.test(fd)) return 'Legacy Giving';
  if (EVENTS_FUND.test(fd)) return 'Events';
  if (MAJOR_FUND.test(fd)) return 'Major Gifts';

  // Signal 5: amount threshold
  if (amt >= 10000) return 'Major Gifts';

  return 'Annual Giving';
}

/**
 * Backfill department for any crm_gifts rows where department IS NULL.
 * Uses the same SQL CASE logic for speed (bulk UPDATE in Postgres).
 * Runs once on first deploy after the column is added, then is a no-op.
 */
async function backfillDepartments() {
  const [[{ cnt }]] = await sequelize.query(
    `SELECT COUNT(*) as cnt FROM crm_gifts WHERE department IS NULL`,
    { type: QueryTypes.SELECT }
  ).then(r => [[r[0] || { cnt: 0 }]]);

  if (Number(cnt) === 0) {
    console.log('[Dept Backfill] All rows classified, nothing to do.');
    return;
  }

  console.log(`[Dept Backfill] Classifying ${cnt} rows...`);
  const t0 = Date.now();

  await sequelize.query(`
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
  `, { type: QueryTypes.UPDATE });

  console.log(`[Dept Backfill] Done in ${Date.now() - t0}ms`);
}

module.exports = { classifyDepartment, backfillDepartments };
