const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { Post, PostComment, User, sequelize } = require('../models');

const CATEGORIES = ['Announcement', 'Question', 'Idea', 'General', 'Shout-Out'];

// ── Pages ──

router.get('/board', ensureAuth, (req, res) => {
  res.render('board/feed', { title: 'Message Board' });
});

router.get('/board/post/:id', ensureAuth, (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!postId || postId < 1) return res.status(400).render('error', { title: 'Bad Request', message: 'Invalid post ID.' });
  res.render('board/post', { title: 'Post', postId });
});

// ── API: Posts ──

// List posts with pagination and category filter
router.get('/api/posts', ensureAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const category = req.query.category;

    const where = { tenantId: req.user.tenantId };
    if (category && CATEGORIES.includes(category)) {
      where.category = category;
    }

    const { count, rows } = await Post.findAndCountAll({
      where,
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'email', 'avatarUrl', 'nickname', 'localAvatarPath'] },
      ],
      order: [['pinned', 'DESC'], ['createdAt', 'DESC']],
      limit,
      offset,
    });

    // Get comment counts in batch
    const postIds = rows.map(p => p.id);
    const commentCounts = postIds.length > 0
      ? await PostComment.findAll({
          attributes: ['postId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where: { postId: postIds },
          group: ['postId'],
          raw: true,
        })
      : [];
    const countMap = {};
    commentCounts.forEach(c => { countMap[c.postId] = parseInt(c.count); });

    const posts = rows.map(p => ({
      id: p.id,
      title: p.title,
      body: p.body,
      category: p.category,
      pinned: p.pinned,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      author: {
        id: p.author.id,
        displayName: p.author.nickname || p.author.name || p.author.email,
        avatarSrc: p.author.localAvatarPath
          ? '/uploads/avatars/' + p.author.localAvatarPath
          : (p.author.avatarUrl || null),
      },
      commentCount: countMap[p.id] || 0,
    }));

    res.json({ posts, total: count, limit, offset });
  } catch (err) {
    console.error('[Board List]', err.message);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// Get single post with comments
router.get('/api/posts/:id', ensureAuth, async (req, res) => {
  try {
    const post = await Post.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'email', 'avatarUrl', 'nickname', 'localAvatarPath'] },
        {
          model: PostComment,
          as: 'comments',
          include: [
            { model: User, as: 'author', attributes: ['id', 'name', 'email', 'avatarUrl', 'nickname', 'localAvatarPath'] },
          ],
          order: [['createdAt', 'ASC']],
        },
      ],
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const formatAuthor = (u) => ({
      id: u.id,
      displayName: u.nickname || u.name || u.email,
      avatarSrc: u.localAvatarPath
        ? '/uploads/avatars/' + u.localAvatarPath
        : (u.avatarUrl || null),
    });

    res.json({
      id: post.id,
      title: post.title,
      body: post.body,
      category: post.category,
      pinned: post.pinned,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: formatAuthor(post.author),
      comments: (post.comments || []).map(c => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        author: formatAuthor(c.author),
      })),
    });
  } catch (err) {
    console.error('[Board Post]', err.message);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// Create post
router.post('/api/posts', ensureAuth, async (req, res) => {
  try {
    const { title, body, category } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!body || !body.trim()) return res.status(400).json({ error: 'Body is required' });
    const cat = CATEGORIES.includes(category) ? category : 'General';

    const post = await Post.create({
      tenantId: req.user.tenantId,
      authorId: req.user.id,
      title: title.trim().substring(0, 255),
      body: body.trim(),
      category: cat,
    });

    res.status(201).json({ id: post.id });
  } catch (err) {
    console.error('[Board Create]', err.message);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Update post (author only)
router.put('/api/posts/:id', ensureAuth, async (req, res) => {
  try {
    const post = await Post.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.authorId !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const { title, body, category } = req.body;
    if (title) post.title = title.trim().substring(0, 255);
    if (body) post.body = body.trim();
    if (category && CATEGORIES.includes(category)) post.category = category;
    await post.save();
    res.json({ id: post.id });
  } catch (err) {
    console.error('[Board Update]', err.message);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete post (author only)
router.delete('/api/posts/:id', ensureAuth, async (req, res) => {
  try {
    const post = await Post.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.authorId !== req.user.id && !req.user.isAdmin()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await post.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[Board Delete]', err.message);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Pin/unpin post (admin only)
router.patch('/api/posts/:id/pin', ensureAuth, async (req, res) => {
  try {
    if (!req.user.isAdmin()) return res.status(403).json({ error: 'Admin access required' });
    const post = await Post.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    post.pinned = !post.pinned;
    await post.save();
    res.json({ id: post.id, pinned: post.pinned });
  } catch (err) {
    console.error('[Board Pin]', err.message);
    res.status(500).json({ error: 'Failed to pin/unpin post' });
  }
});

// ── API: Comments ──

// Add comment
router.post('/api/posts/:id/comments', ensureAuth, async (req, res) => {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

    const post = await Post.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const comment = await PostComment.create({
      postId: post.id,
      authorId: req.user.id,
      body: body.trim(),
    });

    res.status(201).json({ id: comment.id });
  } catch (err) {
    console.error('[Board Comment]', err.message);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Delete comment (author only)
router.delete('/api/comments/:id', ensureAuth, async (req, res) => {
  try {
    const comment = await PostComment.findByPk(req.params.id, {
      include: [{ model: Post, where: { tenantId: req.user.tenantId } }],
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.authorId !== req.user.id && !req.user.isAdmin()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await comment.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[Board Comment Delete]', err.message);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router;
