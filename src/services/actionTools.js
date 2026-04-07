/**
 * Action Centre tools for Ask Fund-Raise AI
 *
 * Provides the create_action tool that allows the AI to create
 * follow-up tasks for team members directly from chat conversations.
 */
const { Action, User, CrmGift } = require('../models');
const { Op } = require('sequelize');

// Tool definition (Claude API format)
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

module.exports = { ACTION_TOOLS, executeActionTool, buildDonorContext };
