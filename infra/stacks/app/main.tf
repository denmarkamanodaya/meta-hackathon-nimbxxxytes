# Local state (git-ignored). Back up terraform.tfstate by hand after each apply.

# The region is set once, in providers.tf; the box and its data volume go in its "a" zone.
data "aws_region" "current" {}

module "app" {
  source = "../../modules/app"

  instance_type     = "t4g.large"
  availability_zone = "${data.aws_region.current.region}a"
  ssh_cidr          = var.ssh_cidr
  ssh_public_key    = var.ssh_public_key
}
