# Local state (git-ignored). Back up terraform.tfstate by hand after each apply.

module "storage" {
  source = "../../modules/storage"

  # The trycloudflare entry lets the phone upload through a quick tunnel to the Mac before the box exists.
  allowed_origins = ["https://localhost", "http://localhost:5173", "https://*.trycloudflare.com"]
}
