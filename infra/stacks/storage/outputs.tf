output "bucket_name" {
  description = "Name of the media bucket (S3_BUCKET in the app's .env)."
  value       = module.storage.bucket_name
}

output "app_policy_json" {
  description = "Least-privilege IAM policy JSON for the app."
  value       = module.storage.app_policy_json
}

output "local_user_name" {
  description = "IAM user to create an access key for by hand (local development only)."
  value       = module.storage.local_user_name
}

output "lifecycle_class_tag" {
  description = "Object tag the app must set on originals and previews for the lifecycle rules to apply."
  value       = module.storage.lifecycle_class_tag
}
