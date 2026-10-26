provider "aws" {
  region  = "ap-southeast-1"
  profile = var.aws_profile

  default_tags {
    tags = {
      project  = "nimbytes"
      lifetime = "hackathon"
    }
  }
}
