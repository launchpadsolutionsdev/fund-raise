const express = require('express');
const request = require('supertest');

// Create mock app
function createApp() {
  const app = express();
  // Mock isAuthenticated
  app.use((req, res, next) => {
    req.isAuthenticated = () => false;
    next();
  });
  // Mock render
  app.set('view engine', 'ejs');
  app.set('views', require('path').join(__dirname, '../../views'));
  // Override render to just return view name
  app.use((req, res, next) => {
    const origRender = res.render.bind(res);
    res.render = (view, opts) => {
      res.json({ view, opts });
    };
    next();
  });
  const landingRouter = require('../../src/routes/landing');
  app.use('/', landingRouter);
  return app;
}

describe('Landing routes', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('GET / renders landing/index when not authenticated', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('landing/index');
  });

  it('GET / redirects to /crm-dashboard when authenticated', async () => {
    const authApp = express();
    authApp.use((req, res, next) => {
      req.isAuthenticated = () => true;
      next();
    });
    authApp.use((req, res, next) => {
      res.render = (view) => res.json({ view });
      next();
    });
    authApp.use('/', require('../../src/routes/landing'));
    const res = await request(authApp).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/crm-dashboard');
  });

  it('GET /privacy renders landing/privacy', async () => {
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('landing/privacy');
  });

  it('GET /terms renders landing/terms', async () => {
    const res = await request(app).get('/terms');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('landing/terms');
  });

  it('GET /whats-new renders landing/whats-new', async () => {
    const res = await request(app).get('/whats-new');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('landing/whats-new');
  });
});
