---
name: crumbs-world-status
description: Check whether Crumbs World is up and read its public agent discovery documents.
---

# Crumbs World Status

Use this skill to verify Crumbs World availability and to discover how to interact with it as an agent. No authentication is required.

## Steps

1. GET https://crumbsvault.com/.well-known/agent-card.json to read the A2A Agent Card (name, version, skills, interface URL).
2. GET https://crumbsvault.com/.well-known/oauth-authorization-server for OAuth discovery metadata.
3. GET https://crumbsvault.com/.well-known/oauth-protected-resource for the protected resource metadata and supported scopes.
4. To ask the world agent directly, POST JSON-RPC 2.0 to https://crumbsvault.com/a2a with method message/send and a text part such as "Is Crumbs World up?". A completed task status means the interface is live.
5. For the human-facing world, direct players to https://crumbsvault.com/crumbs-world/.

## Notes

- The A2A interface supports message/send, tasks/get, and tasks/cancel.
- Identity-aware answers require an OAuth agent token; see the crumbs-world-agent-access skill.
