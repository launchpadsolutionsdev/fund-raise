/**
 * Unified Tool Dispatcher for Ask Fund-Raise
 *
 * Single entry point for routing tool calls to the correct executor.
 * Eliminates the duplicated dispatch logic between chat() and chatStream().
 */
const { CRM_TOOLS, executeCrmTool } = require('./crmTools');
const { ACTION_TOOLS, ACTION_TOOL_NAMES, executeActionToolDispatch } = require('./actionTools');
const { ANALYTICS_TOOLS, ANALYTICS_TOOL_NAMES, executeAnalyticsTool } = require('./analyticsTools');
const { TEAM_TOOLS, TEAM_TOOL_NAMES, executeTeamTool } = require('./teamTools');
const { OPERATIONAL_TOOLS, OPERATIONAL_TOOL_NAMES, executeOperationalTool } = require('./operationalTools');
const { TOOLS: BB_TOOLS, executeTool: executeBlackbaudTool } = require('./blackbaudTools');

const CRM_TOOL_NAMES = CRM_TOOLS.map(t => t.name);

/**
 * Execute a single tool call by name.
 *
 * @param {string} toolName - The tool name from Claude's tool_use block
 * @param {Object} input - The tool input from Claude
 * @param {number} tenantId - Tenant ID for data scoping
 * @param {number} userId - Current user ID (needed for action tools)
 * @returns {Promise<Object>} Tool result
 */
async function executeTool(toolName, input, tenantId, userId) {
  if (ACTION_TOOL_NAMES.includes(toolName)) {
    return executeActionToolDispatch(tenantId, userId, toolName, input);
  }
  if (CRM_TOOL_NAMES.includes(toolName)) {
    return executeCrmTool(tenantId, toolName, input);
  }
  if (ANALYTICS_TOOL_NAMES.includes(toolName)) {
    return executeAnalyticsTool(tenantId, toolName, input);
  }
  if (TEAM_TOOL_NAMES.includes(toolName)) {
    return executeTeamTool(tenantId, toolName, input);
  }
  if (OPERATIONAL_TOOL_NAMES.includes(toolName)) {
    return executeOperationalTool(tenantId, toolName, input);
  }
  // Fallback: Blackbaud tools
  return executeBlackbaudTool(tenantId, toolName, input);
}

/**
 * Get all standard tools (CRM + Action + Analytics + Team + Operational).
 * These are available to admin/uploader roles without Deep Dive.
 */
function getStandardTools() {
  return [
    ...CRM_TOOLS,
    ...ACTION_TOOLS,
    ...ANALYTICS_TOOLS,
    ...TEAM_TOOLS,
    ...OPERATIONAL_TOOLS,
  ];
}

/**
 * Get Blackbaud Deep Dive tools.
 */
function getBlackbaudTools() {
  return [...BB_TOOLS];
}

/**
 * Get the web search tool definition.
 */
function getWebSearchTool() {
  return { type: 'web_search_20250305', name: 'web_search' };
}

module.exports = {
  executeTool,
  getStandardTools,
  getBlackbaudTools,
  getWebSearchTool,
};
