variable "name_prefix" {
  description = "Prefix for every AWS name in this module. The bucket is <name_prefix>-media-<account_id>."
  type        = string
  default     = "nimbytes"
}

variable "allowed_origins" {
  description = "Browser origins allowed to PUT/GET/HEAD objects through presigned URLs (CORS)."
  type        = list(string)

  validation {
    condition     = length(var.allowed_origins) > 0 && !contains(var.allowed_origins, "*")
    error_message = "List at least one origin and never \"*\"."
  }
}

variable "create_local_user" {
  description = "Create the IAM user <name_prefix>-app-local with the app policy (access key is created by hand, never by Terraform)."
  type        = bool
  default     = true
}
