# The state bucket is created by this root itself. Its local state was then moved here with
# "terraform init -migrate-state"; see ../../README.md.
terraform {
  backend "gcs" {
    bucket = "recaller-cloud-tfstate"
    prefix = "bootstrap"
  }
}
