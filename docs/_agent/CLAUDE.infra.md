# infra/ — Terraform

Rules: `/CLAUDE.md` (hard rule 5: **never run `terraform apply` or `destroy` without an owner yes for
that one action**). Terraform conventions: `~/Projects/.claude/rules/stack/terraform.md`, as trimmed
by `/CLAUDE.md`. Bucket config facts: `docs/data-model.md` ("S3 layout").

## Layout

```
modules/storage/   S3 bucket (private, SSE-S3, BPA, CORS exposing ETag, lifecycle) + bucket policy + IAM policy doc
modules/app/       EC2 t4g.large arm64, EBS gp3 data volume, EIP, security group, instance profile, user-data
stacks/storage/    live root: backend + literal values, calls modules/storage   (Phase 0)
stacks/app/        live root: backend + literal values, calls modules/app       (Phase 8)
```

- Region `ap-southeast-2`. Every resource tagged `project = nimbytes`, `lifetime = hackathon`.
- State: local state files are acceptable for a throwaway build **only if** they are git-ignored and
  backed up; preferred is an S3 backend bucket created once by hand (owner decision in Phase 0).
- Least privilege: the app's policy allows only `s3:*Object*`, multipart actions and `ListBucket` on
  this bucket's `users/*` prefix. No `*` actions or resources.

## Gates

```bash
terraform fmt -check -recursive
terraform -chdir=stacks/<stack> validate
terraform -chdir=stacks/<stack> plan     # shown to the owner before any apply
```
