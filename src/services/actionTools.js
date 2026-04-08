/**
 * Action Centre tools for Ask Fund-Raise AI
 *
 * Provides tools to create AND read back actions/tasks, enabling
 * the AI to manage the full action lifecycle from chat conversations.
 */
const { Action, ActionComment, User, CrmGift } = require('../models');
const { Op } = require('sequelize');

// Tool definitions (Claude API format)
const ACTION_TOOLS = [
  {
    name: 'create_action',
    description: 'Create an action/task for a team member to follow up with a donor. Use this when the user explicitly asks to assign a task, create a follow-up, or delegate an action to someone on their team.',
    input_schema: {
      type: 'object',
      properties: {
        assignedToName: {
          type: 'string',
          description: 'The name of the team member to assign this to',
        },
        title: {
          type: 'string',
          description: 'Short title for the action',
        },
        description: {
          type: 'string',
          description: 'Detailed instructions or context',
        },
        constituentName: {
          type: 'string',
          description: 'Name of the donor this action is about',
        },
        constituentId: {
          type: 'string',
          description: 'The constituent ID from the CRM data',
        },
        priority: {
          type: 'string',
          enum: ['normal', 'high', 'urgent'],
          description: 'Priority level',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in YYYY-MM-DD format. Use this when the user says things like "follow up in 2 weeks" or "by next Friday". Calculate the date relative to today.',
        },
      },
      required: ['assignedToName', 'title'],
    },
  },
  {
    name: 'list_actions',
    description: 'List actions/tasks from the Action Centre. Can filter by status, assignment, and priority. Use when asked "What actions are assigned to me?", "What\'s overdue?", "Show me open tasks", "What actions did I create?"',
    input_schema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: ['my_inbox', 'assigned_by_me', 'all'],
          description: '"my_inbox" = actions assigned to the current user, "assigned_by_me" = actions the user created, "all" = all actions (admin view). Default: my_inbox.',
        },
        status: {
          type: 'string',
          enum: ['open', 'pending', 'resolved'],
          description: 'Filter by status. Omit for all statuses.',
        },
        priority: {
          type: 'string',
          enum: ['normal', 'high', 'urgent'],
          description: 'Filter by priority. Omit for all priorities.',
        },
        overdue_only: {
          type: 'boolean',
          description: 'If true, only return actions that are past their due date and not resolved.',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20, max 50)',
        },
      },
    },
  },
  {
    name: 'get_action_stats',
    description: 'Get a summary of action counts: open, pending, resolved, overdue, due today. Use for "How many actions are open?", "What\'s the status of our tasks?", "Action Centre overview."',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Build a donor context snapshot from CRM gift data.
 */
async function buildDonorContext(tenantId, constituentId) {
  const gifts = await CrmGift.findAll({
    where: { tenantId, constituentId },
    order: [['giftDate', 'DESC']],
    attributes: ['giftAmount', 'giftDate', 'fundDescription'],
    raw: true,
  });

  if (gifts.length === 0) return null;

  const totalGiving = gifts.reduce((sum, g) => sum + (parseFloat(g.giftAmount) || 0), 0);
  const lastGift = gifts[0];
  const firstGift = gifts[gifts.length - 1];

  return {
    lifetimeGiving: Math.round(totalGiving * 100) / 100,
    giftCount: gifts.length,
    lastGiftDate: lastGift.giftDate,
    lastGiftAmount: parseFloat(lastGift.giftAmount) || 0,
    lastFund: lastGift.fundDescription,
    firstGiftDate: firstGift.giftDate,
  };
}

/**
 * Execute the create_action tool.
 *
 * @param {number} tenantId
 * @param {number} userId - The current user creating the action
 * @param {Object} input - Tool input from Claude
 */
async function executeActionTool(tenantId, userId, input) {
  const { assignedToName, title, description, constituentName, constituentId, priority, dueDate } = input;

  // Look up the assignee by name (fuzzy match on first name, last name, or nickname)
  const users = await User.findAll({
    where: {
      tenantId,
      isActive: true,
      [Op.or]: [
        { name: { [Op.iLike]: `%${assignedToName}%` } },
        { nickname: { [Op.iLike]: `%${assignedToName}%` } },
      ],
    },
    attributes: ['id', 'name', 'nickname', 'email'],
  });

  if (users.length === 0) {
    return {
      error: `No team member found matching "${assignedToName}". Please check the name and try again. Available team members can be found in the staff directory.`,
    };
  }

  if (users.length > 1) {
    const names = users.map(u => u.nickname || u.name || u.email).join(', ');
    return {
      error: `Multiple team members match "${assignedToName}": ${names}. Please be more specific.`,
    };
  }

  const assignee = users[0];

  // Build donor context if constituentId is provided
  let donorContext = null;
  if (constituentId) {
    donorContext = await buildDonorContext(tenantId, constituentId);
  }

  // Create the action
  const action = await Action.create({
    tenantId,
    assignedById: userId,
    assignedToId: assignee.id,
    title: title.substring(0, 255),
    description: description || null,
    constituentName: constituentName || null,
    constituentId: constituentId || null,
    donorContext,
    priority: ['normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
    dueDate: dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null,
  });

  const assigneeName = assignee.nickname || assignee.name || assignee.email;
  return {
    success: true,
    actionId: action.id,
    message: `Action created: "${title}" assigned to ${assigneeName}.${dueDate ? ` Due: ${dueDate}.` : ''}${constituentName ? ` Donor context for ${constituentName} has been attached.` : ''} They'll see it in their Action Centre.`,
  };
}

/**
 * Execute the list_actions tool.
 */
async function executeListActions(tenantId, userId, input) {
  const view = input.view || 'my_inbox';
  const limit = Math.min(input.limit || 20, 50);

  const where = { tenantId };

  // View filtering
  if (view === 'my_inbox') {
    where.assignedToId = userId;
  } else if (view === 'assigned_by_me') {
    where.assignedById = userId;
  }
  // 'all' = no user filter (admin view)

  // Status filtering
  if (input.status) {
    where.status = input.status;
  }

  // Priority filtering
  if (input.priority) {
    where.priority = input.priority;
  }

  // Overdue filtering
  if (input.overdue_only) {
    where.status = { [Op.ne]: 'resolved' };
    where.dueDate = { [Op.lt]: new Date().toISOString().split('T')[0] };
  }

  const actions = await Action.findAll({
    where,
    order: [
      ['status', 'ASC'],        // open first, then pending, then resolved
      ['priority', 'ASC'],      // urgent first
      ['dueDate', 'ASC'],       // soonest due first
      ['createdAt', 'DESC'],
    ],
    limit,
    include: [
      { model: User, as: 'assignedTo', attributes: ['name', 'nickname', 'email'] },
      { model: User, as: 'assignedBy', attributes: ['name', 'nickname', 'email'] },
    ],
  });

  const today = new Date().toISOString().split('T')[0];

  return {
    actions: actions.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description ? a.description.substring(0, 200) : null,
      status: a.status,
      priority: a.priority,
      constituentName: a.constituentName,
      assignedTo: a.assignedTo?.nickname || a.assignedTo?.name || a.assignedTo?.email || 'Unknown',
      assignedBy: a.assignedBy?.nickname || a.assignedBy?.name || a.assignedBy?.email || 'Unknown',
      dueDate: a.dueDate,
      isOverdue: a.dueDate && a.status !== 'resolved' && a.dueDate < today,
      createdAt: a.createdAt,
      resolvedAt: a.resolvedAt,
    })),
    total: actions.length,
    view,
  };
}

/**
 * Execute the get_action_stats tool.
 */
async function executeGetActionStats(tenantId) {
  const today = new Date().toISOString().split('T')[0];

  const allActions = await Action.findAll({
    where: { tenantId },
    attributes: ['status', 'priority', 'dueDate'],
    raw: true,
  });

  const stats = {
    total: allActions.length,
    open: allActions.filter(a => a.status === 'open').length,
    pending: allActions.filter(a => a.status === 'pending').length,
    resolved: allActions.filter(a => a.status === 'resolved').length,
    overdue: allActions.filter(a => a.status !== 'resolved' && a.dueDate && a.dueDate < today).length,
    dueToday: allActions.filter(a => a.status !== 'resolved' && a.dueDate === today).length,
    urgent: allActions.filter(a => a.status !== 'resolved' && a.priority === 'urgent').length,
    highPriority: allActions.filter(a => a.status !== 'resolved' && a.priority === 'high').length,
  };

  return stats;
}

// Unified action tool executor
async function executeActionToolDispatch(tenantId, userId, toolName, input) {
  switch (toolName) {
    case 'create_action':
      return executeActionTool(tenantId, userId, input);
    case 'list_actions':
      return executeListActions(tenantId, userId, input);
    case 'get_action_stats':
      return executeGetActionStats(tenantId);
    default:
      return { error: `Unknown action tool: ${toolName}` };
  }
}

// All tool names for dispatch checking
const ACTION_TOOL_NAMES = ACTION_TOOLS.map(t => t.name);

module.exports = { ACTION_TOOLS, ACTION_TOOL_NAMES, executeActionTool, executeActionToolDispatch, buildDonorContext };
