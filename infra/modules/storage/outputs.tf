output "bucket_name" {
  description = "Name of the media bucket."
  value       = aws_s3_bucket.media.bucket
}

output "bucket_arn" {
  description = "ARN of the media bucket."
  value       = aws_s3_bucket.media.arn
}

output "app_policy_json" {
  description = "Least-privilege IAM policy JSON for the app (attach to the instance role at deploy time)."
  value       = data.aws_iam_policy_document.app.json
}

output "local_user_name" {
  description = "IAM user for local development, or null when create_local_user is false."
  value       = var.create_local_user ? aws_iam_user.local[0].name : null
}

output "lifecycle_class_tag" {
  description = "Object tag the app must set so lifecycle rules apply: key plus the value per object class."
  value = {
    key      = local.class_tag_key
    original = local.class_tag_original
    preview  = local.class_tag_preview
  }
}
