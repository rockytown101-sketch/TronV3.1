# Optional production callback service

The desktop app contains a localhost callback listener for development. For remote mobile-wallet callbacks, deploy an HTTPS service and put its URL into Settings.

Recommended endpoints:
POST /wallet/callback
GET  /health

Persist callback events by actionId and verify:
- actionId exists
- request is still pending
- target address matches expected C
- transaction hash is 64 hex characters
- proposal hash matches the stored request
- then query the chain before marking EXECUTED

Do not trust a wallet callback alone as proof of on-chain execution.
