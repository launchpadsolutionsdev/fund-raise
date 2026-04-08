/**
 * Shared validation middleware using express-validator.
 *
 * Usage in routes:
 *   const { body, query } = require('express-validator');
 *   const { handleValidation } = require('../middleware/validate');
 *
 *   router.post('/foo',
 *     body('title').trim().notEmpty().withMessage('Title is required'),
 *     handleValidation,
 *     async (req, res) => { ... }
 *   );
 */

const { validationResult } = require('express-validator');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
  const errorList = errors.array().map(e => e.msg);

  if (isAjax) {
    return res.status(400).json({ error: errorList[0], errors: errorList });
  }

  req.flash('error', errorList.join('. '));
  return res.redirect('back');
}

module.exports = { handleValidation };
