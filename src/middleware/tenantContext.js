/**
 * Tenant Context Middleware
 *
 * Sets PostgreSQL session variable `app.current_tenant_id` so that
 * Row-Level Security policies can enforce tenant isolation at the
 * database level.
 *
 * Approach: For each authenticated request, we run
 *   SET LOCAL app.current_tenant_id = '<tenantId>'
 * inside a transaction. SET LOCAL is transaction-scoped, so it
 * automatically resets when the transaction completes — no risk of
 * leaking tenant context to the next request that reuses the same
 * pooled connection.
 *
 * We use Sequelize's CLS (Continuation Local Storage) integration so
 * that all queries made during the request automatically join the
 * same transaction without passing `{ transaction }` everywhere.
 *
 * For unauthenticated requests (login, health check, OAuth callbacks),
 * no tenant context is set. The RLS bypass policy allows access when
 * app.current_tenant_id is NULL/empty.
 */

const cls = require('cls-hooked');
const { Sequelize } = require('sequelize');

// Create the CLS namespace — must happen BEFORE Sequelize is instantiated
// if we want automatic transaction propagation. Since models/index.js
// creates the Sequelize instance at require-time, we call this in the
// init function below which must be invoked before requiring models.
const NAMESPACE_NAME = 'fund-raise-tenant';

/**
 * Initialize CLS for Sequelize. MUST be called before requiring
 * src/models/index.js (i.e., at the very top of app.js).
 */
function initTenantCLS() {
  const ns = cls.createNamespace(NAMESPACE_NAME);
  Sequelize.useCLS(ns);
  return ns;
}

/**
 * Express middleware that sets the tenant context for RLS.
 *
 * For authenticated requests: wraps the rest of the request in a
 * Sequelize transaction with SET LOCAL app.current_tenant_id.
 *
 * For unauthenticated requests: passes through (RLS bypass policy
 * allows access when the setting is NULL).
 */
function tenantContextMiddleware(sequelize) {
  return (req, res, next) => {
    // Skip for unauthenticated requests — RLS bypass policy handles this
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user || !req.user.tenantId) {
      return next();
    }

    const tenantId = req.user.tenantId;

    // Start a managed transaction. All Sequelize queries in this request
    // will automatically use this transaction via CLS.
    sequelize.transaction(async (t) => {
      // SET LOCAL is scoped to this transaction — resets automatically
      await sequelize.query(
        `SET LOCAL app.current_tenant_id = '${parseInt(tenantId, 10)}'`,
        { transaction: t }
      );

      // Run the rest of the Express middleware/route handlers inside
      // this transaction by wrapping next() in a promise
      return new Promise((resolve, reject) => {
        res.on('finish', resolve);
        res.on('close', resolve);
        res.on('error', reject);
        next();
      });
    }).catch((err) => {
      // If the transaction fails and headers haven't been sent, forward error
      if (!res.headersSent) {
        next(err);
      } else {
        console.error('[TenantContext] Transaction error after headers sent:', err.message);
      }
    });
  };
}

module.exports = { initTenantCLS, tenantContextMiddleware };
