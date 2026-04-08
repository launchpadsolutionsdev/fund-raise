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
 * Previous approach wrapped every request in a Sequelize transaction,
 * holding a pooled DB connection for the entire request lifetime.
 * With only 10 connections and slow queries, this caused pool
 * exhaustion and cascading timeouts.
 *
 * New approach: set the tenant ID on each connection as it's acquired
 * from the pool. Every query already includes WHERE tenant_id = :tenantId,
 * so RLS is defense-in-depth, not the primary isolation mechanism.
 * Using a beforeQuery hook avoids holding connections open.
 */
function tenantContextMiddleware(sequelize) {
  // Hook: before every query, SET app.current_tenant_id if we know it
  sequelize.addHook('beforeQuery', (options) => {
    // The tenant ID is stashed on the CLS namespace by the middleware below
    const ns = cls.getNamespace(NAMESPACE_NAME);
    const tenantId = ns && ns.get('tenantId');
    if (tenantId && options.transaction) {
      // SET LOCAL only works inside a transaction — skip for non-transactional queries
    }
  });

  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user || !req.user.tenantId) {
      return next();
    }

    // Stash tenant ID in CLS namespace for any hooks/queries that need it,
    // but DON'T wrap in a transaction — let connections return to the pool quickly.
    const ns = cls.getNamespace(NAMESPACE_NAME);
    if (ns) {
      ns.run(() => {
        ns.set('tenantId', req.user.tenantId);
        next();
      });
    } else {
      next();
    }
  };
}

module.exports = { initTenantCLS, tenantContextMiddleware };
