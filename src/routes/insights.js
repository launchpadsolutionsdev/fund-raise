const router = require('express').Router();

// Articles data — add new articles here
const articles = [
  {
    slug: 'ai-in-fundraising-how-artificial-intelligence-is-changing-nonprofit-giving',
    title: 'AI in Fundraising: How Artificial Intelligence Is Changing Nonprofit Giving',
    description: 'Over 80% of nonprofits now use AI, yet most fundraising teams barely scratch the surface. Learn where AI delivers real results — and how Fund-Raise puts it to work for your foundation.',
    category: 'Data & Trends',
    categoryColor: '#0891B2',
    date: 'April 9, 2026',
    dateISO: '2026-04-09',
    readTime: '11 min read',
    featured: true,
  },
  {
    slug: 'recurring-giving-why-monthly-donors-are-your-most-valuable-supporters',
    title: 'The Power of Recurring Giving: Why Monthly Donors Are Your Most Valuable Supporters',
    description: 'Monthly donors retain at 80–90% compared to 40–45% for one-time givers. Learn how to build a recurring giving program that delivers predictable revenue and deeper donor relationships.',
    category: 'Fundraising Strategy',
    categoryColor: '#059669',
    date: 'March 31, 2026',
    dateISO: '2026-03-31',
    readTime: '10 min read',
    featured: false,
  },
  {
    slug: 'what-is-a-lybunt-sybunt-report',
    title: 'What Is a LYBUNT / SYBUNT Report?',
    description: 'LYBUNT and SYBUNT reports identify lapsed donors before it\'s too late. Learn how to use them to recover at-risk revenue and strengthen your donor retention strategy.',
    category: 'Donor Analytics',
    categoryColor: '#0072BB',
    date: 'March 19, 2026',
    dateISO: '2026-03-19',
    readTime: '8 min read',
    featured: false,
  },
  {
    slug: 'why-fund-raise-replaces-your-blackbaud-analytics-stack',
    title: 'Why Fund-Raise Replaces Your Entire Blackbaud Analytics Stack',
    description: 'Foundations running RE NXT cobble together 4\u20136 tools costing $7,000\u2013$24,000/year. Fund-Raise replaces them all with one platform at $199/month. Here\u2019s exactly what you can retire.',
    category: 'Platform',
    categoryColor: '#FFAA00',
    date: 'March 7, 2026',
    dateISO: '2026-03-07',
    readTime: '12 min read',
    featured: false,
  },
  {
    slug: 'donor-retention-rate-the-most-important-metric',
    title: 'Donor Retention Rate: The Most Important Metric You\u2019re Probably Ignoring',
    description: 'The average nonprofit retains just 43\u201345% of donors year over year. Learn how to calculate, benchmark, and improve your donor retention rate \u2014 with practical strategies that work.',
    category: 'Donor Analytics',
    categoryColor: '#0072BB',
    date: 'February 22, 2026',
    dateISO: '2026-02-22',
    readTime: '10 min read',
    featured: false,
  },
  {
    slug: 'what-is-rfm-scoring-donor-segmentation-guide',
    title: 'What Is RFM Scoring? A Fundraiser\u2019s Guide to Donor Segmentation',
    description: 'RFM scoring ranks donors by Recency, Frequency, and Monetary value to reveal who your best supporters are \u2014 and who\u2019s slipping away. Learn how to use it for smarter fundraising.',
    category: 'Donor Segmentation',
    categoryColor: '#8B5CF6',
    date: 'February 10, 2026',
    dateISO: '2026-02-10',
    readTime: '11 min read',
    featured: false,
  },
  {
    slug: 'the-fundraisers-guide-to-board-reporting',
    title: 'The Fundraiser\u2019s Guide to Board Reporting: What Your Board Actually Wants to See',
    description: 'Stop overwhelming your board with data dumps. Learn the five metrics that matter, the six mistakes to avoid, and how to build board reports that drive strategy instead of confusion.',
    category: 'Fundraising Strategy',
    categoryColor: '#059669',
    date: 'January 28, 2026',
    dateISO: '2026-01-28',
    readTime: '9 min read',
    featured: false,
  },
  {
    slug: 'first-time-donor-conversion-turning-one-time-gifts-into-lifelong-supporters',
    title: 'First-Time Donor Conversion: Turning One-Time Gifts into Lifelong Supporters',
    description: 'Only 19\u201322% of first-time donors give again. Learn the proven strategies \u2014 from the 48-hour thank-you to the 90-day conversion window \u2014 that turn one-time gifts into lasting relationships.',
    category: 'Donor Analytics',
    categoryColor: '#0072BB',
    date: 'January 15, 2026',
    dateISO: '2026-01-15',
    readTime: '10 min read',
    featured: false,
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
