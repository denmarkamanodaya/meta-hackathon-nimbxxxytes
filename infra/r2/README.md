# R2 bucket settings

The media bucket `nimbytes-media` lives in Cloudflare R2, with the location hint Oceania (OC) and the
Standard storage class. It was set up in the Cloudflare dashboard on 2026-10-27.

- `cors.json` is the bucket's CORS policy, exactly as applied. Browsers upload multipart parts with PUT
  and read `ETag`; media is read with GET and Range.
- Lifecycle: Cloudflare's default rule aborts incomplete multipart uploads after 7 days. Old agent
  preview videos are removed by the app's cleanup job, because R2 lifecycle rules can't filter on
  object tags.
- Access: the API token `nimbytes-server` is Object Read & Write on this bucket only. Its keys live in
  the server `.env` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) and are never committed.

To re-apply the CORS policy: `npx wrangler r2 bucket cors set nimbytes-media --file infra/r2/cors.json`.
