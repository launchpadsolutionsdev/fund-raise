/**
 * Audit Service — logs critical user actions for compliance and debugging.
 *
 * Usage:
 *   const audit = require('../services/auditService');
 *   await audit.log(req, 'crm_import', 'data', {
 *     targetType: 'CrmImport',
 *     targetId: importId,
 *     description: 'Imported 4,320 gifts from Blackbaud export',
 *     metadata: { filename, recordCount },
 *   });
 */

const { AuditLog } = require('../models');

/**
 * Write an audit log entry.
 * @param {Object} req - Express request (used for user, tenant, IP)
 * @param {string} action - Action identifier (e.g. 'crm_import', 'delete_post')
 * @param {string} category - Category ('data', 'security', 'team', 'admin')
 * @param {Object} opts
 * @param {string} [opts.targetType] - Model name of the target
 * @param {string|number} [opts.targetId] - ID of the target record
 * @param {string} opts.description - Human-readable description
 * @param {Object} [opts.metadata] - Extra context
 */
async function log(req, action, category, opts = {}) {
  try {
    await AuditLog.create({
      tenantId: req.user ? req.user.tenantId : null,
      userId: req.user ? req.user.id : null,
      action,
      category,
      targetType: opts.targetType || null,
      targetId: opts.targetId != null ? String(opts.targetId) : null,
      description: opts.description || action,
      metadata: opts.metadata || null,
      ipAddress: req.ip || req.connection?.remoteAddress || null,
    });
  } catch (err) {
    // Audit logging should never break the main flow
    console.error('[AuditLog] Failed to write:', err.message);
  }
}

module.exports = { log };
