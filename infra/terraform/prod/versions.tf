terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4"
    }
    # Only for the Firebase resources the google provider doesn't have yet. Keep both on the same version.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.4"
    }
  }
}
