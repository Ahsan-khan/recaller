resource "google_project" "this" {
  project_id      = var.project_id
  name            = var.project_name
  billing_account = var.billing_account
  labels          = local.labels

  # Terraform refuses to delete the project, even on "terraform destroy".
  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true

    # The billing link is recorded here but never changed by Terraform. Terraform reads it through
    # the Cloud Billing API, which is off in this project, and unlinking billing would stop the
    # database and the bucket. See ../../README.md.
    ignore_changes = [billing_account]
  }
}
