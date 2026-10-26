output "instance_id" {
  description = "EC2 instance id."
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "Elastic IP of the app box."
  value       = aws_eip.app.public_ip
}

output "site_address" {
  description = "Public hostname for Caddy: the Elastic IP, dashed, under sslip.io."
  value       = "${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
}

output "ssh_user" {
  description = "Login user on Amazon Linux 2023."
  value       = "ec2-user"
}
