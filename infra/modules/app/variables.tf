variable "name_prefix" {
  description = "Prefix for every AWS name in this module."
  type        = string
  default     = "nimbytes"
}

variable "instance_type" {
  description = "EC2 instance type (arm64 / Graviton, the image is built for linux/arm64)."
  type        = string
  default     = "c7g.xlarge"
}

variable "availability_zone" {
  description = "AZ for the instance and its data volume (an EBS volume only attaches inside its own AZ)."
  type        = string
}

variable "root_volume_size_gb" {
  description = "Root gp3 volume size: OS, Docker images and the ONNX models."
  type        = number
  default     = 20
}

variable "data_volume_size_gb" {
  description = "Data gp3 volume size, mounted at /srv/nimbytes/data (SQLite, search index, scratch media)."
  type        = number
  default     = 30
}

variable "ssh_cidr" {
  description = "CIDR allowed to reach port 22, for example the owner's IP as x.x.x.x/32."
  type        = string

  validation {
    condition     = can(cidrhost(var.ssh_cidr, 0)) && var.ssh_cidr != "0.0.0.0/0"
    error_message = "Give a valid CIDR other than 0.0.0.0/0."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH public key for ec2-user (deploys run over SSH)."
  type        = string
}

variable "app_policy_json" {
  description = "IAM policy JSON the app needs (the storage stack's app_policy_json output)."
  type        = string
}

variable "app_uid" {
  description = "Numeric uid the api container runs as; it owns the data directory."
  type        = number
  default     = 10001
}

variable "compose_version" {
  description = "Docker Compose plugin release installed by user-data."
  type        = string
  default     = "v5.6.1"
}

variable "compose_sha256" {
  description = "sha256 of docker-compose-linux-aarch64 for compose_version (from the release's .sha256 asset)."
  type        = string
  default     = "42cfa75f51ad0ccf290bad37899e0038a8c10a0069e85233ecc1d53e3ff1347d"
}
