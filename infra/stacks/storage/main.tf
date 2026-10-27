# Local state (git-ignored). Back up terraform.tfstate by hand after each apply.

module "storage" {
  source = "../../modules/storage"

  # trycloudflare: the phone uploads through a quick tunnel to the Mac. sslip.io: the judging box's
  # address (its Elastic IP, dashed).
  allowed_origins = ["https://localhost", "http://localhost:5173", "https://*.trycloudflare.com", "https://3-104-132-162.sslip.io"]
}
