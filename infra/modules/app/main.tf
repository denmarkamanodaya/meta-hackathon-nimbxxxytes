# Latest Amazon Linux 2023 arm64 AMI, resolved through the public SSM parameter.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "default" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = var.availability_zone
  default_for_az    = true
}

locals {
  app_dir  = "/srv/nimbytes"
  data_dir = "/srv/nimbytes/data"
}

# --- network ---

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = "HTTP/HTTPS from anywhere, SSH from one CIDR"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP (ACME challenge and redirect to HTTPS)"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS"
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = var.ssh_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  description       = "SSH for deploys"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound: S3, Meta Model API, image pulls, package installs"
}

# --- identity ---

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name_prefix}-app"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy" "app" {
  name   = "${var.name_prefix}-media-access"
  role   = aws_iam_role.app.id
  policy = var.app_policy_json
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name_prefix}-app"
  role = aws_iam_role.app.name
}

resource "aws_key_pair" "deploy" {
  key_name   = "${var.name_prefix}-deploy"
  public_key = var.ssh_public_key
}

# --- compute and storage ---

resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${var.name_prefix}-data"
  }

  # Holds the SQLite database and search index; remove this guard on purpose when tearing down.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.insecure_value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.default.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  key_name               = aws_key_pair.deploy.key_name

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    # Nitro exposes EBS volumes as NVMe devices whose serial is the volume id without the dash.
    data_volume_serial = replace(aws_ebs_volume.data.id, "-", "")
    app_dir            = local.app_dir
    data_dir           = local.data_dir
    app_uid            = var.app_uid
    compose_version    = var.compose_version
    compose_sha256     = var.compose_sha256
  })
  user_data_replace_on_change = true

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2 # containers reach IMDSv2 through the Docker bridge
  }

  root_block_device {
    volume_size = var.root_volume_size_gb
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.name_prefix}-app"
  }

  # A new AMI release must not replace the running box.
  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}

resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name = "${var.name_prefix}-app"
  }
}

resource "aws_eip_association" "app" {
  allocation_id = aws_eip.app.id
  instance_id   = aws_instance.app.id
}
