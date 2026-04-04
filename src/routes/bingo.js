const router = require('express').Router();
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const { sequelize } = require('../models');

// Bingo uses lightweight JSON storage in a single table row per tenant
// No separate model needed — we'll store the board config and player state in JSONB

// We'll create a simple bingo_boards table inline via sync
const { DataTypes } = require('sequelize');
const BingoBoard = sequelize.define('BingoBoard', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tenantId: { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_id', unique: true },
  title: { type: DataTypes.STRING(255), defaultValue: 'Fundraising Bingo' },
  // 5x5 grid of challenge squares
  squares: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  // { [userId]: [squareIndex, ...] }
  completions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'bingo_boards',
  timestamps: true,
  underscored: true,
});

const DEFAULT_SQUARES = [
  'Get a new recurring donor',
  'Send 5 thank-you letters',
  'Secure a gift over $1,000',
  'Host a donor meeting',
  'Write a grant application',
  'Get a corporate sponsor',
  'Recruit an event volunteer',
  'Post on Foundation social media',
  'Tour a donor through the hospital',
  'Close a planned gift conversation',
  'Get a lapsed donor to give again',
  'Attend a community event',
  'FREE SPACE',
  'Hit a department weekly goal',
  'Send a handwritten note',
  'Make 10 donor calls in a day',
  'Secure an in-kind donation',
  'Get a donor testimonial',
  'Organize a stewardship touchpoint',
  'Bring in a first-time donor',
  'Submit a Blackbaud report',
  'Present at a team meeting',
  'Update 20 donor records',
  'Write a compelling case for support',
  'Celebrate a colleague\'s win',
];

// ── Page ──
router.get('/bingo', ensureAuth, (req, res) => {
  res.render('bingo/board', { title: 'Fundraising Bingo' });
});

// ── API ──

// Get or create the current bingo board
router.get('/api/bingo', ensureAuth, async (req, res) => {
  try {
    let board = await BingoBoard.findOne({ where: { tenantId: req.user.tenantId, active: true } });
    if (!board) {
      // Create default board
      board = await BingoBoard.create({
        tenantId: req.user.tenantId,
        squares: DEFAULT_SQUARES,
        completions: {},
      });
    }
    const userCompletions = board.completions[req.user.id] || [];
    res.json({
      id: board.id,
      title: board.title,
      squares: board.squares,
      myCompletions: userCompletions,
      allCompletions: board.completions,
    });
  } catch (err) {
    console.error('[Bingo]', err.message);
    res.status(500).json({ error: 'Failed to load bingo board' });
  }
});

// Toggle a square completion for the current user
router.post('/api/bingo/toggle', ensureAuth, async (req, res) => {
  try {
    const { squareIndex } = req.body;
    if (typeof squareIndex !== 'number' || squareIndex < 0 || squareIndex > 24) {
      return res.status(400).json({ error: 'Invalid square index' });
    }

    const board = await BingoBoard.findOne({ where: { tenantId: req.user.tenantId, active: true } });
    if (!board) return res.status(404).json({ error: 'No active bingo board' });

    const completions = { ...board.completions };
    const userId = String(req.user.id);
    if (!completions[userId]) completions[userId] = [];

    const idx = completions[userId].indexOf(squareIndex);
    if (idx === -1) {
      completions[userId].push(squareIndex);
    } else {
      completions[userId].splice(idx, 1);
    }

    board.completions = completions;
    board.changed('completions', true); // Force Sequelize to detect JSONB change
    await board.save();

    // Check for bingo
    const hasBingo = checkBingo(completions[userId]);

    res.json({
      myCompletions: completions[userId],
      hasBingo,
    });
  } catch (err) {
    console.error('[Bingo Toggle]', err.message);
    res.status(500).json({ error: 'Failed to update bingo' });
  }
});

// Reset the board (admin only)
router.post('/api/bingo/reset', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const { squares } = req.body;
    const board = await BingoBoard.findOne({ where: { tenantId: req.user.tenantId, active: true } });
    if (board) {
      board.squares = squares && squares.length === 25 ? squares : DEFAULT_SQUARES;
      board.completions = {};
      board.changed('completions', true);
      board.changed('squares', true);
      await board.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset board' });
  }
});

// Get leaderboard
router.get('/api/bingo/leaderboard', ensureAuth, async (req, res) => {
  try {
    const board = await BingoBoard.findOne({ where: { tenantId: req.user.tenantId, active: true } });
    if (!board) return res.json([]);

    const { User } = require('../models');
    const users = await User.findAll({
      where: { tenantId: req.user.tenantId, isActive: true },
      attributes: ['id', 'name', 'nickname', 'avatarUrl', 'localAvatarPath'],
    });
    const userMap = {};
    users.forEach(u => {
      userMap[u.id] = {
        displayName: u.nickname || u.name || 'Unknown',
        avatarSrc: u.localAvatarPath ? '/uploads/avatars/' + u.localAvatarPath : (u.avatarUrl || null),
      };
    });

    const leaderboard = Object.entries(board.completions || {})
      .map(([userId, squares]) => ({
        userId: parseInt(userId),
        displayName: userMap[userId] ? userMap[userId].displayName : 'Unknown',
        avatarSrc: userMap[userId] ? userMap[userId].avatarSrc : null,
        completed: squares.length,
        hasBingo: checkBingo(squares),
      }))
      .sort((a, b) => b.completed - a.completed);

    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

function checkBingo(completions) {
  if (!completions || completions.length < 5) return false;
  const set = new Set(completions);

  // Check rows
  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every(c => set.has(r * 5 + c))) return true;
  }
  // Check columns
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => set.has(r * 5 + c))) return true;
  }
  // Diagonals
  if ([0,6,12,18,24].every(i => set.has(i))) return true;
  if ([4,8,12,16,20].every(i => set.has(i))) return true;

  return false;
}

module.exports = router;
