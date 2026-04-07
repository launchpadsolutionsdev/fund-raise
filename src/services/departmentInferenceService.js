/**
 * AI-Powered Department Inference Service
 *
 * After CRM import completes, samples gift data and uses Claude to detect
 * the tenant's fundraising departments and generate classification rules.
 * These rules replace the hardcoded regex patterns on a per-tenant basis.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { Sequelize } = require('sequelize');
const { sequelize, CrmGift, TenantDataConfig } = require('../models');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildInferencePrompt(sampleGifts, distinctValues) {
  return `You are analyzing fundraising data from a nonprofit foundation that uses Blackbaud Raiser's Edge NXT. Your job is to determine what fundraising departments this organization operates and create classification rules for assigning each gift to a department.

IMPORTANT CONTEXT:
- Every nonprofit organizes their RE NXT data differently
- Some track events as campaigns, others as appeals, others as funds
- Some foundations don't have certain departments at all (e.g., no Events department)
- Campaign, Fund, and Appeal fields are used inconsistently across organizations
- Data quality varies — some fields may be empty, inconsistent, or poorly maintained
- Common fundraising departments include: Annual Giving, Major Gifts, Events, Direct Mail, Legacy/Planned Giving, Capital Campaign, Corporate/Foundation Relations, Stewardship
- Not every organization will have all of these — only detect departments that clearly exist in the data

DISTINCT VALUES IN THIS DATABASE:

Fund Descriptions: ${JSON.stringify(distinctValues.funds.slice(0, 100))}

Fund Categories: ${JSON.stringify(distinctValues.fundCategories.slice(0, 50))}

Campaign Descriptions: ${JSON.stringify(distinctValues.campaigns.slice(0, 100))}

Appeal Descriptions: ${JSON.stringify(distinctValues.appeals.slice(0, 100))}

Appeal Categories: ${JSON.stringify(distinctValues.appealCategories.slice(0, 50))}

Gift Codes: ${JSON.stringify(distinctValues.giftCodes.slice(0, 50))}

SAMPLE OF 500 GIFTS (showing key classification fields):
${JSON.stringify(sampleGifts.slice(0, 500), null, 0)}

INSTRUCTIONS:
1. Analyze the distinct values and sample data to determine which fundraising departments this organization operates.
2. Determine HOW they organize their data — do they use campaigns, appeals, funds, or gift codes to distinguish departments? Which field is their primary organizational field?
3. Create classification rules that can be applied programmatically to assign every gift to a department.
4. If a gift doesn't match any rule, assign it to a default department (usually Annual Giving or General).
5. Be conservative — only detect departments you're confident exist based on clear patterns in the data.

Respond with ONLY valid JSON (no markdown, no backticks, no preamble) in this exact structure:

{
  "departments": ["Annual Giving", "Events", "Major Gifts"],
  "summary": "This foundation tracks 3 departments. Events are identified through appeal descriptions containing event names. Major gifts are identified by gift amounts over $10,000. Everything else falls under Annual Giving.",
  "primaryOrganizationalField": "appealDescription",
  "dataStructureNotes": "This organization uses appeals to track individual solicitations and events. Campaigns appear to represent fiscal years. Funds track designated vs unrestricted giving.",
  "confidence": 0.87,
  "classificationRules": [
    {
      "department": "Events",
      "priority": 1,
      "field": "appealDescription",
      "matchType": "regex",
      "pattern": "gala|dinner|golf|auction|tournament|walk|run|concert",
      "caseSensitive": false,
      "rationale": "Appeal descriptions contain event-specific names"
    },
    {
      "department": "Events",
      "priority": 2,
      "field": "appealCategory",
      "matchType": "exact",
      "pattern": "Special Event",
      "caseSensitive": false,
      "rationale": "Appeal category explicitly labels events"
    },
    {
      "department": "Major Gifts",
      "priority": 3,
      "field": "giftAmount",
      "matchType": "gte",
      "pattern": "10000",
      "rationale": "Gifts of $10,000+ are typically major gifts"
    },
    {
      "department": "Annual Giving",
      "priority": 99,
      "field": "*",
      "matchType": "default",
      "pattern": "",
      "rationale": "Default department for unclassified gifts"
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Main inference function
// ---------------------------------------------------------------------------

async function inferDepartmentStructure(tenantId) {
  console.log(`[DEPT INFERENCE] Starting inference for tenant ${tenantId}...`);

  // 1. Pull 500 random gifts
  const sampleGifts = await CrmGift.findAll({
    where: { tenantId },
    order: Sequelize.literal('RANDOM()'),
    limit: 500,
    attributes: [
      'giftAmount', 'giftDate', 'giftType', 'giftCode',
      'fundDescription', 'fundCategory', 'fundId',
      'campaignDescription', 'campaignId', 'campaignCategory',
      'appealDescription', 'appealId', 'appealCategory',
      'constituentCode', 'packageDescription',
    ],
    raw: true,
  });

  if (sampleGifts.length === 0) {
    throw new Error('No gifts found for this tenant. Import data first.');
  }

  // 2. Get distinct values for key classification fields
  // Use actual DB column names for Sequelize.col() (not model attribute names)
  const distinctQueries = {
    funds: 'fund_description',
    campaigns: 'campaign_description',
    appeals: 'appeal_description',
    giftCodes: 'gift_code',
    fundCategories: 'fund_category',
    appealCategories: 'appeal_category',
  };

  const distinctValues = {};
  for (const [key, col] of Object.entries(distinctQueries)) {
    const rows = await CrmGift.findAll({
      where: { tenantId },
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col(col)), 'value']],
      raw: true,
    });
    distinctValues[key] = rows.map(r => r.value).filter(Boolean);
  }

  console.log(`[DEPT INFERENCE] Sample: ${sampleGifts.length} gifts, ${distinctValues.funds.length} funds, ${distinctValues.campaigns.length} campaigns, ${distinctValues.appeals.length} appeals`);

  // 3. Call Claude
  const client = getClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: buildInferencePrompt(sampleGifts, distinctValues),
    }],
  });

  // 4. Parse response
  const responseText = response.content[0].text.trim();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (parseErr) {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      result = JSON.parse(jsonMatch[1].trim());
    } else {
      console.error('[DEPT INFERENCE] Failed to parse AI response:', responseText.substring(0, 500));
      throw new Error('AI response was not valid JSON. Please try again or configure departments manually.');
    }
  }

  // Validate required fields
  if (!result.departments || !Array.isArray(result.departments) || !result.classificationRules || !Array.isArray(result.classificationRules)) {
    throw new Error('AI response missing required fields (departments, classificationRules). Please try again.');
  }

  // Ensure there's a default rule
  const hasDefault = result.classificationRules.some(r => r.matchType === 'default');
  if (!hasDefault) {
    result.classificationRules.push({
      department: 'Annual Giving',
      priority: 99,
      field: '*',
      matchType: 'default',
      pattern: '',
      rationale: 'Default department for unclassified gifts',
    });
  }

  console.log(`[DEPT INFERENCE] Detected ${result.departments.length} departments: ${result.departments.join(', ')} (confidence: ${result.confidence})`);

  // 5. Store in TenantDataConfig
  await TenantDataConfig.update({
    detectedDepartments: {
      departments: result.departments,
      confidence: result.confidence,
      inferredAt: new Date(),
      summary: result.summary,
      primaryOrganizationalField: result.primaryOrganizationalField,
      dataStructureNotes: result.dataStructureNotes,
    },
    departmentClassificationRules: result.classificationRules,
  }, { where: { tenantId } });

  // 6. Reclassify all gifts
  const totalUpdated = await reclassifyGifts(tenantId, result.classificationRules);
  console.log(`[DEPT INFERENCE] Reclassified ${totalUpdated} gifts.`);

  return {
    departments: result.departments,
    confidence: result.confidence,
    summary: result.summary,
    dataStructureNotes: result.dataStructureNotes,
    totalReclassified: totalUpdated,
  };
}

// ---------------------------------------------------------------------------
// Classification using AI-generated rules
// ---------------------------------------------------------------------------

function classifyDepartmentByTenantRules(gift, rules) {
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (rule.matchType === 'default') {
      return rule.department;
    }

    const fieldValue = gift[rule.field];
    if (fieldValue == null) continue;

    let matched = false;
    switch (rule.matchType) {
      case 'regex':
        try {
          matched = new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i').test(String(fieldValue));
        } catch (_) {
          // Invalid regex — skip this rule
        }
        break;
      case 'exact':
        matched = rule.caseSensitive
          ? String(fieldValue).trim() === rule.pattern
          : String(fieldValue).trim().toLowerCase() === rule.pattern.toLowerCase();
        break;
      case 'gte':
        matched = parseFloat(fieldValue) >= parseFloat(rule.pattern);
        break;
      case 'contains':
        matched = rule.caseSensitive
          ? String(fieldValue).includes(rule.pattern)
          : String(fieldValue).toLowerCase().includes(rule.pattern.toLowerCase());
        break;
    }

    if (matched) {
      return rule.department;
    }
  }

  return 'Annual Giving';
}

// ---------------------------------------------------------------------------
// Bulk reclassification
// ---------------------------------------------------------------------------

async function reclassifyGifts(tenantId, rules) {
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
  const batchSize = 500;
  let offset = 0;
  let totalUpdated = 0;

  while (true) {
    const gifts = await CrmGift.findAll({
      where: { tenantId },
      limit: batchSize,
      offset,
      raw: true,
    });

    if (gifts.length === 0) break;

    // Build bulk update queries
    const updates = [];
    for (const gift of gifts) {
      let department = null;
      for (const rule of sortedRules) {
        if (rule.matchType === 'default') {
          department = rule.department;
          break;
        }
        const fieldValue = gift[rule.field];
        if (fieldValue == null) continue;
        let matched = false;
        switch (rule.matchType) {
          case 'regex':
            try { matched = new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i').test(String(fieldValue)); } catch (_) {}
            break;
          case 'exact':
            matched = rule.caseSensitive
              ? String(fieldValue).trim() === rule.pattern
              : String(fieldValue).trim().toLowerCase() === rule.pattern.toLowerCase();
            break;
          case 'gte':
            matched = parseFloat(fieldValue) >= parseFloat(rule.pattern);
            break;
          case 'contains':
            matched = rule.caseSensitive
              ? String(fieldValue).includes(rule.pattern)
              : String(fieldValue).toLowerCase().includes(rule.pattern.toLowerCase());
            break;
        }
        if (matched) { department = rule.department; break; }
      }

      if (department && department !== gift.department) {
        updates.push({ id: gift.id, department });
      }
    }

    // Batch update using CASE WHEN for efficiency
    if (updates.length > 0) {
      const ids = updates.map(u => u.id);
      const cases = updates.map(u =>
        `WHEN id = ${parseInt(u.id)} THEN ${sequelize.escape(u.department)}`
      ).join(' ');

      await sequelize.query(
        `UPDATE crm_gifts SET department = CASE ${cases} END WHERE id IN (${ids.join(',')})`,
      );
      totalUpdated += updates.length;
    }

    offset += batchSize;
  }

  return totalUpdated;
}

module.exports = {
  inferDepartmentStructure,
  classifyDepartmentByTenantRules,
  reclassifyGifts,
};
