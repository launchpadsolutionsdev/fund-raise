/**
 * Team Collaboration Tools for Ask Fund-Raise
 *
 * Read-only access to team features: board posts, kudos, milestones,
 * bingo progress, quick notes, and staff directory.
 */
const { Post, PostComment, Kudos, Milestone, User, QuickNote } = require('../models');
const { Op } = require('sequelize');

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TEAM_TOOLS = [
  {
    name: 'get_board_posts',
    description: 'Get recent posts from the team message board. Shows announcements, questions, ideas, and shout-outs. Use when asked "What\'s happening on the board?", "Any announcements?", "What is the team talking about?"',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category: "Announcement", "Question", "Idea", "General", "Shout-Out"' },
        limit: { type: 'number', description: 'Number of posts to return (default 10, max 25)' },
      },
    },
  },
  {
    name: 'get_recent_kudos',
    description: 'Get recent kudos/recognition sent between team members. Shows who is being recognized and for what. Use for "Who got kudos recently?", "Any team recognition?", "Show me recent shout-outs."',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of kudos to return (default 10, max 25)' },
      },
    },
  },
  {
    name: 'get_milestones',
    description: 'Get campaign milestones and their status. Shows fundraising milestones, whether they\'ve been reached, and progress. Use for "What milestones have we hit?", "How close are we to our next milestone?"',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_team_directory',
    description: 'Get the team directory: who is on the team, their roles, and job titles. Use when asked "Who is on the team?", "What is [name]\'s role?", or to find someone to assign actions to.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// All tool names for dispatch checking
const TEAM_TOOL_NAMES = TEAM_TOOLS.map(t => t.name);

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

async function executeGetBoardPosts(tenantId, input) {
  const where = { tenantId };
  if (input.category) where.category = input.category;

  const limit = Math.min(input.limit || 10, 25);

  const posts = await Post.findAll({
    where,
    order: [['pinned', 'DESC'], ['createdAt', 'DESC']],
    limit,
    include: [
      { model: User, as: 'author', attributes: ['name', 'nickname', 'jobTitle'] },
    ],
  });

  // Get comment counts
  const postIds = posts.map(p => p.id);
  const commentCounts = {};
  if (postIds.length > 0) {
    const comments = await PostComment.findAll({
      where: { postId: postIds },
      attributes: ['postId'],
    });
    for (const c of comments) {
      commentCounts[c.postId] = (commentCounts[c.postId] || 0) + 1;
    }
  }

  return {
    posts: posts.map(p => ({
      title: p.title,
      body: p.body ? p.body.substring(0, 300) + (p.body.length > 300 ? '...' : '') : null,
      category: p.category,
      author: p.author?.nickname || p.author?.name || 'Unknown',
      authorTitle: p.author?.jobTitle || null,
      pinned: p.pinned,
      commentCount: commentCounts[p.id] || 0,
      postedAt: p.createdAt,
    })),
    total: posts.length,
  };
}

async function executeGetRecentKudos(tenantId, input) {
  const limit = Math.min(input.limit || 10, 25);

  const kudos = await Kudos.findAll({
    where: { tenantId },
    order: [['createdAt', 'DESC']],
    limit,
    include: [
      { model: User, as: 'fromUser', attributes: ['name', 'nickname'] },
      { model: User, as: 'toUser', attributes: ['name', 'nickname'] },
    ],
  });

  return {
    kudos: kudos.map(k => ({
      from: k.fromUser?.nickname || k.fromUser?.name || 'Unknown',
      to: k.toUser?.nickname || k.toUser?.name || 'Unknown',
      message: k.message,
      category: k.category,
      emoji: k.emoji,
      reactions: k.reactions || [],
      sentAt: k.createdAt,
    })),
    total: kudos.length,
  };
}

async function executeGetMilestones(tenantId) {
  const milestones = await Milestone.findAll({
    where: { tenantId },
    order: [['reached', 'ASC'], ['targetValue', 'ASC']],
    include: [
      { model: User, as: 'createdBy', attributes: ['name', 'nickname'] },
    ],
  });

  return {
    milestones: milestones.map(m => ({
      title: m.title,
      description: m.description,
      type: m.milestoneType,
      targetValue: m.targetValue,
      department: m.department,
      reached: m.reached,
      reachedAt: m.reachedAt,
      celebrationEmoji: m.celebrationEmoji,
      createdBy: m.createdBy?.nickname || m.createdBy?.name || 'System',
    })),
    total: milestones.length,
    reached: milestones.filter(m => m.reached).length,
    pending: milestones.filter(m => !m.reached).length,
  };
}

async function executeGetTeamDirectory(tenantId) {
  const users = await User.findAll({
    where: { tenantId, isActive: true },
    attributes: ['id', 'name', 'nickname', 'email', 'role', 'jobTitle', 'lastLogin'],
    order: [['name', 'ASC']],
  });

  return {
    team: users.map(u => ({
      name: u.nickname || u.name,
      fullName: u.name,
      email: u.email,
      role: u.role,
      jobTitle: u.jobTitle || null,
      lastActive: u.lastLogin,
    })),
    total: users.length,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const EXECUTORS = {
  get_board_posts: executeGetBoardPosts,
  get_recent_kudos: executeGetRecentKudos,
  get_milestones: executeGetMilestones,
  get_team_directory: executeGetTeamDirectory,
};

async function executeTeamTool(tenantId, toolName, input) {
  const executor = EXECUTORS[toolName];
  if (!executor) return { error: `Unknown team tool: ${toolName}` };
  try {
    return await executor(tenantId, input || {});
  } catch (err) {
    console.error(`[Team Tool] ${toolName} error:`, err.message);
    return { error: `Team query failed: ${err.message}` };
  }
}

module.exports = { TEAM_TOOLS, TEAM_TOOL_NAMES, executeTeamTool };
