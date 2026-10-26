# Local state (git-ignored). Back up terraform.tfstate by hand after each apply.

module "storage" {
  source = "../../modules/storage"

  allowed_origins = ["https://localhost", "http://localhost:5173"]
}
