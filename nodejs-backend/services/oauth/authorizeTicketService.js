/**
 * authorizeTicketService — short-lived signed payload carrying the validated
 * OAuth /authorize params from the backend hand-off to the frontend consent
 * screen, and back to POST /oauth/consent.
 *
 * Why a ticket?
 *   /oauth/authorize is a GET that fully validates every OAuth param + the
 *   client's registration. We don't want to re-validate everything at
 *   /oauth/consent — the ticket is our proof that we already did.
 *
 *   The ticket also PINS the exact scopes, redirect_uri, and PKCE challenge,
 *   so a malicious frontend can't POST /oauth/consent with a mutated payload
 *   and get us to issue a code for something the user hasn't seen.
 *
 * Format: HS256 JWT signed with JWT_SECRET_KEY, TTL 10 minutes.
 *
 * Fields:
 *   client_id, redirect_uri, scopes[], state, code_challenge,
 *   code_challenge_method, nonce, resource
 */

const jwt = require("jsonwebtoken");

const TICKET_TTL_SECONDS = Number(
  process.env.OAUTH_AUTHORIZE_TICKET_TTL_SECONDS || 600,
);

function signTicket(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET_KEY, {
    algorithm: "HS256",
    expiresIn: TICKET_TTL_SECONDS,
    audience: "oauth-authorize-ticket",
  });
}

function verifyTicket(ticket) {
  try {
    return jwt.verify(ticket, process.env.JWT_SECRET_KEY, {
      algorithms: ["HS256"],
      audience: "oauth-authorize-ticket",
    });
  } catch {
    return null;
  }
}

module.exports = { signTicket, verifyTicket, TICKET_TTL_SECONDS };
