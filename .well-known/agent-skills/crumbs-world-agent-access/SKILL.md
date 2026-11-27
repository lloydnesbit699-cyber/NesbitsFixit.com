---
name: crumbs-world-agent-access
description: Register an AI agent for Crumbs World with a player-claimed OAuth token and call the agent APIs.
---

# Crumbs World Agent Access

Use this skill when an AI agent needs to act for a Crumbs World player with the player's permission. The player never shares a password; the agent receives a short-lived, scoped token.

## Steps

1. Read https://crumbsvault.com/auth.md for the current registration contract.
2. Start registration: POST https://crumbsvault.com/agent/identity with JSON body {"type": "identity_assertion", "assertion_type": "verified_email", "login_hint": "<player email>"}.
3. The response includes a claim_uri and a short user_code. Ask the human player to sign in at the claim page and enter the code. Do not proceed until the player confirms.
4. Poll POST https://crumbsvault.com/oauth2/token with the device_code from step 2 until it returns an access_token (scope crumbs.read, one hour).
5. Call GET https://crumbsvault.com/api/agent/me with header Authorization: Bearer <access_token> to confirm the bound player.
6. To talk to the world agent, POST JSON-RPC 2.0 to https://crumbsvault.com/a2a using method message/send. Include the Bearer token for identity-aware replies.
7. When finished, POST https://crumbsvault.com/oauth2/revoke to cancel the token.

## Rules

- Never ask the player for a password, session cookie, or device code beyond the claim code flow above.
- Treat authorization_pending as "wait and poll again", not as an error.
- Tokens expire after one hour; repeat the claim flow for a fresh token.
