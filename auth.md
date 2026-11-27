# Crumbs Vault auth.md

This document describes how AI agents may access Crumbs Vault services on behalf of a human user. It is the public discovery document for agent access; there is no OAuth authorization server for this service, so this file is self-contained.

## Audience

Agents acting for a human player or visitor of Crumbs World, and agents reading public Crumbs Vault pages.

## Public access (no credentials)

The public, read-only API needs no account and no credentials:

- Service health: `GET /api/health`
- Launcher versions: `GET /api/launcher-version`
- Session state: `GET /api/auth/me` (reports `logged_in: false` for anonymous callers)

Machine-readable description: https://crumbsvault.com/crumbs-world/openapi.json
API catalog: https://crumbsvault.com/.well-known/api-catalog

## Accounts and registration

Crumbs World player accounts are provisioned by the human user, not self-registered by agents.

- Registration method: user-provisioned account. The human creates their account through the game's own sign-up flow at https://crumbsvault.com/crumbs-world/ and completes any sign-in steps themselves.
- Agents must not create accounts, submit sign-up forms, or request enrollment codes on their own initiative.
- There is no public agent-registration endpoint and no anonymous credential issuance.

## Credential use

- After the human signs in, the game uses a session cookie. Agents may act only within a session the human has established and authorized.
- Never ask the human to share a password, one-time code, passkey, or device enrollment code in chat or in a form.
- The owner account additionally requires a registered device. A password alone does not authenticate the owner; do not attempt to bypass the device gate.
- Sessions expire. When a session ends, stop and ask the human to sign in again rather than retrying credentials.

## Supported methods

- `anonymous` read-only access to the public endpoints above.
- `user-provisioned` account access through the human's own browser session.

## Contact

Questions about agent access: crumbzdevops26@gmail.com
Human-readable help: https://crumbsvault.com/crumbs-world/faq/
