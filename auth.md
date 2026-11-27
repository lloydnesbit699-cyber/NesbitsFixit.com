# Crumbs Vault auth.md

This document describes how AI agents may access Crumbs Vault services on behalf of a human user. Crumbs World runs an OAuth authorization server for agent access; this file is the human-readable companion to its machine-readable discovery metadata.

Discovery:
- OAuth authorization server metadata: https://crumbsvault.com/.well-known/oauth-authorization-server
- OAuth protected resource metadata: https://crumbsvault.com/.well-known/oauth-protected-resource
- Authorization server issuer: https://crumbsvault.com
- JWKS: https://crumbsvault.com/oauth2/jwks.json

## Audience

Agents acting for a human player or visitor of Crumbs World, and agents reading public Crumbs Vault pages.

## Public access (no credentials)

The public, read-only API needs no account and no credentials:

- Service health: `GET /api/health`
- Launcher versions: `GET /api/launcher-version`
- Session state: `GET /api/auth/me` (reports `logged_in: false` for anonymous callers)

Machine-readable description: https://crumbsvault.com/crumbs-world/openapi.json
API catalog: https://crumbsvault.com/.well-known/api-catalog

## Agent registration

Agent registration uses the user-claimed `service_auth` flow. An agent never creates a player account and never receives the human's password.

- `register_uri`: https://crumbsvault.com/agent/identity
- `identity_types_supported`: `service_auth`
- `claim_uri`: https://crumbsvault.com/agent/claim
- `token_endpoint`: https://crumbsvault.com/oauth2/token
- `revocation_endpoint`: https://crumbsvault.com/oauth2/revoke
- Grant type: `urn:ietf:params:oauth:grant-type:device_code`
- Scope: `crumbs.read`

Flow:
1. The agent sends `POST /agent/identity` with `{"type": "service_auth", "login_hint": "<the human's email>"}`.
2. The server returns a `device_code`, a short `user_code`, and the claim URI.
3. The human signs in to Crumbs World themselves, opens the claim URI (which sends them to the game sign-in host), and enters the `user_code`. Claim completion requires the human's real signed-in session; the owner account's registered-device gate still applies.
4. The agent polls `POST /oauth2/token` with the device-code grant. Before the claim it receives `authorization_pending`; after the claim it receives a short-lived Bearer access token.
5. The agent calls protected endpoints with `Authorization: Bearer <token>`. The first protected endpoint is `GET /api/agent/me`, which returns the bound username and scope.
6. Tokens expire after one hour and can be cancelled at the revocation endpoint.

## Accounts

Crumbs World player accounts are provisioned by the human user through the game's own sign-up flow at https://crumbsvault.com/crumbs-world/. Agent registration binds an agent to an existing human account only after the human completes the claim step.

- Agents must not create accounts, submit sign-up forms, or request enrollment codes on their own initiative.
- There is no anonymous credential issuance. Public read-only endpoints remain available without credentials.

## Credential use

- Use Bearer access tokens only for the scope granted. The current scope is read-only: `crumbs.read`.
- Never ask the human to share a password, one-time code, passkey, or device enrollment code in chat or in a form.
- The owner account additionally requires a registered device. A password alone does not authenticate the owner; do not attempt to bypass the device gate.
- When a token expires or is revoked, stop and ask the human to approve a new claim rather than retrying credentials.

## Supported methods

- `anonymous` read-only access to the public endpoints above.
- `service_auth` user-claimed agent registration for scoped Bearer-token access.
- `user-provisioned` account access through the human's own browser session.

## Contact

Questions about agent access: crumbzdevops26@gmail.com
Human-readable help: https://crumbsvault.com/crumbs-world/faq/
