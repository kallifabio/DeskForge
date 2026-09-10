// auth.js
//
// Single Sign-on über Authentik per OpenID Connect (Authorization Code
// Flow mit PKCE). Nutzt openid-client v5 (CommonJS-kompatibel per
// require()).
//
// Liest zusätzlich den "groups"-Claim aus dem Userinfo-Endpoint, um
// Administratoren (Mitglieder der in AUTHENTIK_ADMIN_GROUP konfigurierten
// Gruppe) von normalen Nutzern zu unterscheiden. Damit das funktioniert,
// muss der OAuth2/OIDC-Provider in Authentik den "groups"-Scope in den
// Token aufnehmen - siehe docs/SETUP.md, Abschnitt 7.2.
//
// HINWEIS: openid-client v6+ ist ESM-only und hat eine funktionale statt
// klassenbasierte API. Falls das Projekt später auf v6 aktualisiert wird,
// muss dieses Modul entsprechend der openid-client-Migrationsanleitung
// angepasst werden.

const express = require('express');
const { Issuer, generators } = require('openid-client');
const config = require('./config');

// Muss mit dem name in sessionStore.js übereinstimmen.
const COOKIE_NAME = 'deskforge.sid';

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = Issuer.discover(config.authentik.issuerUrl)
      .then(
        (issuer) =>
          new issuer.Client({
            client_id: config.authentik.clientId,
            client_secret: config.authentik.clientSecret,
            redirect_uris: [config.authentik.redirectUri],
            response_types: ['code'],
          })
      )
      .catch((err) => {
        // Ein rejektiertes Promise NICHT dauerhaft cachen - sonst schlägt
        // jeder weitere Login-Versuch bis zum Neustart fehl.
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

function buildAuthRouter() {
  const router = express.Router();

  router.get('/login', async (req, res, next) => {
    try {
      const client = await getClient();
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      req.session.oidc = { state, nonce, codeVerifier };
      const url = client.authorizationUrl({
        scope: 'openid profile email groups',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  });

  router.get('/callback', async (req, res, next) => {
    try {
      const client = await getClient();
      const params = client.callbackParams(req);
      const { state, nonce, codeVerifier } = req.session.oidc || {};
      const tokenSet = await client.callback(config.authentik.redirectUri, params, {
        state,
        nonce,
        code_verifier: codeVerifier,
      });
      const userinfo = await client.userinfo(tokenSet.access_token);
      const groups = Array.isArray(userinfo.groups) ? userinfo.groups : [];
      req.session.user = {
        sub: userinfo.sub,
        username: userinfo.preferred_username || userinfo.name,
        email: userinfo.email,
        groups,
        isAdmin: groups.includes(config.authentik.adminGroup),
      };
      // Für den RP-initiated Logout benötigt (id_token_hint).
      req.session.idToken = tokenSet.id_token;
      delete req.session.oidc;
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  });

  router.get('/logout', (req, res) => {
    const idToken = req.session && req.session.idToken;
    req.session.destroy(async () => {
      res.clearCookie(COOKIE_NAME);
      // RP-initiated Logout: auch die Authentik-SSO-Sitzung beenden,
      // sonst loggt "Anmelden" sofort wieder ein.
      try {
        const client = await getClient();
        if (client.issuer.metadata.end_session_endpoint) {
          const params = { id_token_hint: idToken };
          if (config.authentik.postLogoutRedirectUri) {
            params.post_logout_redirect_uri = config.authentik.postLogoutRedirectUri;
          }
          return res.redirect(client.endSessionUrl(params));
        }
      } catch (_) {
        // Authentik nicht erreichbar / kein end_session_endpoint -
        // der lokale Logout oben genügt dann.
      }
      res.redirect('/auth/login');
    });
  });

  return router;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.path && req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }
  return res.redirect('/auth/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.isAdmin) {
    return next();
  }
  return res.status(403).json({ error: 'Nur für Administratoren' });
}

module.exports = { buildAuthRouter, requireAuth, requireAdmin };
