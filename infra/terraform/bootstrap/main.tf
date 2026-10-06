# Bootstrap: the bucket that holds Terraform state for this project (this root's own state
# included, under the "bootstrap" prefix), and who may read it. Apply it before the prod root.
# See ../../README.md.

provider "google" {
  project = var.project_id
  region  = var.region

  # Called with a user login (gcloud ADC), some Google APIs need a quota project.
  user_project_override = true
  billing_project       = var.project_id
}

locals {
  state_bucket = coalesce(var.state_bucket, "${var.project_id}-tfstate")
}

resource "google_storage_bucket" "tfstate" {
  name                        = local.state_bucket
  project                     = var.project_id
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  # Every state write is kept as a version, so an earlier state can always be recovered.
  versioning {
    enabled = true
  }

  # Keep the 20 most recent old versions, and none older than a year.
  lifecycle_rule {
    condition {
      num_newer_versions = 20
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 365
      with_state                 = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    app        = "recaller"
    purpose    = "terraform-state"
    managed-by = "terraform"
  }

  # Kept in state, so Terraform refuses to delete the bucket even if this block is removed.
  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }
}

# The state holds the app's API key and the sign-in password-hash parameters, so only project
# owners may read or write it. This replaces Cloud Storage's default bucket policy, which also lets
# project viewers read the state and editors write it. roles/owner has no object permissions of
# its own: owners reach the bucket only through these projectOwner bindings, so both must stay.
data "google_iam_policy" "tfstate" {
  binding {
    role    = "roles/storage.legacyBucketOwner"
    members = ["projectOwner:${var.project_id}"]
  }

  binding {
    role    = "roles/storage.legacyObjectOwner"
    members = ["projectOwner:${var.project_id}"]
  }
}

# Never delete this block. Destroying the policy sets an EMPTY one on the bucket, which locks
# everyone, owners included, out of the state. To stop managing it, use a "removed" block with
# destroy = false. See ../../README.md.
resource "google_storage_bucket_iam_policy" "tfstate" {
  bucket      = google_storage_bucket.tfstate.name
  policy_data = data.google_iam_policy.tfstate.policy_data

  lifecycle {
    prevent_destroy = true
  }
}
