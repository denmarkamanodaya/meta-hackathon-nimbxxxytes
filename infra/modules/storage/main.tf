data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  bucket_name = "${var.name_prefix}-media-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.region}"

  # Lifecycle filters only match a key prefix from the start of the key, with no wildcards. Object
  # keys are users/{user_id}/originals/... and users/{user_id}/previews/..., so a prefix filter
  # cannot select "every user's originals". The app tags these objects when it writes them
  # (x-amz-tagging on CreateMultipartUpload / PutObject) and the lifecycle rules filter on the tag.
  class_tag_key      = "nimbytes-class"
  class_tag_original = "original"
  class_tag_preview  = "preview"
}

resource "aws_s3_bucket" "media" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id

  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["*"]
    # Browser multipart upload reads each part's ETag to complete the upload.
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "originals-intelligent-tiering"
    status = "Enabled"

    filter {
      tag {
        key   = local.class_tag_key
        value = local.class_tag_original
      }
    }

    transition {
      days          = 0
      storage_class = "INTELLIGENT_TIERING"
    }
  }

  rule {
    id     = "previews-expire"
    status = "Enabled"

    filter {
      tag {
        key   = local.class_tag_key
        value = local.class_tag_preview
      }
    }

    expiration {
      days = 7
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    # AbortIncompleteMultipartUpload does not accept tag filters, and an upload in progress has no
    # tags yet, so this rule uses the users/ prefix that every object key starts with.
    filter {
      prefix = "users/"
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.media]
}

data "aws_iam_policy_document" "deny_insecure_transport" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.deny_insecure_transport.json

  depends_on = [aws_s3_bucket_public_access_block.media]
}

# Least-privilege policy for the app (local IAM user now, EC2 instance role at deploy time).
data "aws_iam_policy_document" "app" {
  statement {
    sid = "UserObjects"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.media.arn}/users/*"]
  }

  # PutObject / CreateMultipartUpload with x-amz-tagging also needs s3:PutObjectTagging. Only the
  # lifecycle class tag may be set.
  statement {
    sid       = "LifecycleClassTag"
    actions   = ["s3:PutObjectTagging"]
    resources = ["${aws_s3_bucket.media.arn}/users/*"]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "s3:RequestObjectTagKeys"
      values   = [local.class_tag_key]
    }
  }

  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.media.arn]
  }
}

resource "aws_iam_user" "local" {
  count = var.create_local_user ? 1 : 0

  name = "${var.name_prefix}-app-local"
}

resource "aws_iam_user_policy" "local" {
  count = var.create_local_user ? 1 : 0

  name   = "${var.name_prefix}-media-access"
  user   = aws_iam_user.local[0].name
  policy = data.aws_iam_policy_document.app.json
}
