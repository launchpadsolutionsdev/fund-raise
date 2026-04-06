const router = require('express').Router();

// Articles data — add new articles here
const articles = [
  {
    slug: 'what-is-a-lybunt-sybunt-report',
    title: 'What Is a LYBUNT / SYBUNT Report?',
    description: 'LYBUNT and SYBUNT reports identify lapsed donors before it\'s too late. Learn how to use them to recover at-risk revenue and strengthen your donor retention strategy.',
    category: 'Donor Analytics',
    categoryColor: '#0072BB',
    date: 'April 6, 2026',
    dateISO: '2026-04-06',
    readTime: '8 min read',
    featured: true,
  },
];

// Insights index
router.get('/insights', (req, res) => {
  if (req.isAuthenticated()) {
    // Still show insights even for logged-in users
  }
  res.render('insights/index', { articles });
});

// Individual article
router.get('/insights/:slug', (req, res) => {
  const article = articles.find(a => a.slug === req.params.slug);
  if (!article) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Article not found.' });
  }
  res.render('insights/' + article.slug, { article, articles });
});

module.exports = router;
