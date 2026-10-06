# State lives in the bucket made by ../bootstrap. A backend block can't read variables, so the
# bucket is named here.
terraform {
  backend "gcs" {
    bucket = "recaller-cloud-tfstate"
    prefix = "prod"
  }
}
