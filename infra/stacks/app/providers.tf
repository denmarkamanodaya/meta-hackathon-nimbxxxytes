provider "aws" {
  region  = "ap-southeast-2"
  profile = var.aws_profile

  default_tags {
    tags = {
      project  = "nimbytes"
      lifetime = "hackathon"
    }
  }
}
