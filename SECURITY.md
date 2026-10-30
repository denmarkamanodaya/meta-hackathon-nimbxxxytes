# Security policy

nimbytes stores people's personal footage, so security reports are welcome and handled first.

## Report a vulnerability

Please do **not** open a public issue. Use **Security › Report a vulnerability** on this
repository (a private advisory only the maintainer sees). Include what is affected, how to
reproduce it, and the impact. The maintainer will reply as soon as possible.

## What is in scope

- The API (`api/`), the web app and PWA (`web/`), the Mac app (`desktop/`), the renderer
  (`render/`) and the infrastructure code (`infra/`).
- Especially: access to another user's footage, faces, documents or recordings; leaked storage
  URLs; authentication and session handling.

## How nimbytes protects data

Private, encrypted object storage with short-lived presigned URLs; every API route checks the
owner; Meta API calls are made with storage off; secrets live only in the server's environment,
never in the repository.
