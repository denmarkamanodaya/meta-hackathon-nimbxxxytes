variable "aws_profile" {
  description = "Named AWS CLI profile to run Terraform with (no default: choose it explicitly)."
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH to the box, for example the owner's IP as x.x.x.x/32."
  type        = string
}

variable "ssh_public_key" {
  description = "OpenSSH public key for ec2-user."
  type        = string
}
