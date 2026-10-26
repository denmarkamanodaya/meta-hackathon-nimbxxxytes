output "instance_id" {
  description = "EC2 instance id."
  value       = module.app.instance_id
}

output "public_ip" {
  description = "Elastic IP of the app box (scripts/deploy.sh reads this)."
  value       = module.app.public_ip
}

output "site_address" {
  description = "Public hostname for Caddy (SITE_ADDRESS)."
  value       = module.app.site_address
}

output "ssh_user" {
  description = "Login user for deploys."
  value       = module.app.ssh_user
}
