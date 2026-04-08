/**
 * Operational Tools for Ask Fund-Raise
 *
 * Data freshness, import history, connection status,
 * and system health information.
 */
const { CrmImport, Snapshot, BlackbaudToken, User } = require('../models');
const blackbaudClient = require('./blackbaudClient');

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const OPERATIONAL_TOOLS = [
  {
    name: 'get_data_freshness',
    description: 'Check when data was last imported/uploaded and how fresh it is. Shows CRM import history and snapshot dates. Use when asked "When was our data last updated?", "Is our data current?", "When was the last import?"',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_import_history',
    description: 'Get the history of CRM data imports: dates, file names, row counts, status (completed/failed), who uploaded. Use for "Show me recent imports", "Did the last upload work?", "How many records were imported?"',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of imports to return (default 10, max 25)' },
      },
    },
  },
  {
    name: 'get_connection_status',
    description: 'Check the status of external integrations (Blackbaud CRM connection). Shows if the connection is active, when it was last refreshed, and the connected environment. Use for "Is Blackbaud connected?", "Is our CRM link working?"',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// All tool names for dispatch checking
const OPERATIONAL_TOOL_NAMES = OPERATIONAL_TOOLS.map(t => t.name);

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

async function executeGetDataFreshness(tenantId) {
  // Check latest CRM import
  const latestImport = await CrmImport.findOne({
    where: { tenantId, status: 'completed' },
    order: [['completedAt', 'DESC']],
    attributes: ['fileName', 'completedAt', 'totalRows', 'giftsUpserted'],
    include: [{ model: User, as: 'uploader', attributes: ['name', 'nickname'] }],
  });

  // Check latest snapshot
  const latestSnapshot = await Snapshot.findOne({
    where: { tenantId },
    order: [['snapshotDate', 'DESC']],
    attributes: ['snapshotDate', 'uploadedAt'],
    include: [{ model: User, as: 'uploader', attributes: ['name', 'nickname'] }],
  });

  const now = new Date();
  let crmFreshness = null;
  if (latestImport?.completedAt) {
    const ageMs = now - new Date(latestImport.completedAt);
    const ageHours = Math.round(ageMs / (1000 * 60 * 60));
    const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
    crmFreshness = {
      lastImportDate: latestImport.completedAt,
      fileName: latestImport.fileName,
      totalRows: latestImport.totalRows,
      giftsUpserted: latestImport.giftsUpserted,
      uploadedBy: latestImport.uploader?.nickname || latestImport.uploader?.name || 'Unknown',
      ageHours,
      ageDays,
      status: ageDays <= 1 ? 'fresh' : ageDays <= 7 ? 'recent' : ageDays <= 30 ? 'aging' : 'stale',
    };
  }

  let snapshotFreshness = null;
  if (latestSnapshot) {
    const ageMs = now - new Date(latestSnapshot.uploadedAt || latestSnapshot.snapshotDate);
    const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
    snapshotFreshness = {
      snapshotDate: latestSnapshot.snapshotDate,
      uploadedAt: latestSnapshot.uploadedAt,
      uploadedBy: latestSnapshot.uploader?.nickname || latestSnapshot.uploader?.name || 'Unknown',
      ageDays,
      status: ageDays <= 7 ? 'fresh' : ageDays <= 30 ? 'recent' : 'stale',
    };
  }

  return {
    crmData: crmFreshness || { status: 'no_data', message: 'No CRM data has been imported yet.' },
    snapshotData: snapshotFreshness || { status: 'no_data', message: 'No snapshots have been uploaded yet.' },
  };
}

async function executeGetImportHistory(tenantId, input) {
  const limit = Math.min(input.limit || 10, 25);

  const imports = await CrmImport.findAll({
    where: { tenantId },
    order: [['createdAt', 'DESC']],
    limit,
    include: [{ model: User, as: 'uploader', attributes: ['name', 'nickname'] }],
  });

  return {
    imports: imports.map(i => ({
      fileName: i.fileName,
      fileSize: i.fileSize,
      status: i.status,
      totalRows: i.totalRows,
      giftsUpserted: i.giftsUpserted,
      fundraisersUpserted: i.fundraisersUpserted,
      softCreditsUpserted: i.softCreditsUpserted,
      matchesUpserted: i.matchesUpserted,
      errorMessage: i.errorMessage,
      uploadedBy: i.uploader?.nickname || i.uploader?.name || 'Unknown',
      uploadedAt: i.createdAt,
      completedAt: i.completedAt,
    })),
    total: imports.length,
  };
}

async function executeGetConnectionStatus(tenantId) {
  let blackbaud = { connected: false, message: 'Blackbaud is not configured.' };

  if (blackbaudClient.isConfigured()) {
    try {
      const status = await blackbaudClient.getConnectionStatus(tenantId);
      blackbaud = {
        connected: status.connected,
        environmentName: status.environmentName || null,
        connectedAt: status.connectedAt || null,
        lastRefreshed: status.lastRefreshedAt || null,
        dailyLimitReached: blackbaudClient.isDailyLimitReached ? blackbaudClient.isDailyLimitReached() : false,
      };
    } catch (err) {
      blackbaud = { connected: false, error: err.message };
    }
  }

  return { blackbaud };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const EXECUTORS = {
  get_data_freshness: executeGetDataFreshness,
  get_import_history: executeGetImportHistory,
  get_connection_status: executeGetConnectionStatus,
};

async function executeOperationalTool(tenantId, toolName, input) {
  const executor = EXECUTORS[toolName];
  if (!executor) return { error: `Unknown operational tool: ${toolName}` };
  try {
    return await executor(tenantId, input || {});
  } catch (err) {
    console.error(`[Operational Tool] ${toolName} error:`, err.message);
    return { error: `Operational query failed: ${err.message}` };
  }
}

module.exports = { OPERATIONAL_TOOLS, OPERATIONAL_TOOL_NAMES, executeOperationalTool };
