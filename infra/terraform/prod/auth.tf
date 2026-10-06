# Firebase Authentication on Identity Platform: email and password sign-in. Email enumeration
# protection and the password policy (8+ characters) are also on; the provider can't express
# them, so ../../scripts/auth-settings.sh sets them and Terraform never sends them (see ../../README.md).
#
# The provider doesn't mark sign_in.hash_config (the password-hash signer key and salt separator)
# as sensitive. A plan that imports, replaces or destroys this resource prints it, and so do
# "terraform show" and "terraform state show": mask it as ../../README.md shows.
resource "google_identity_platform_config" "this" {
  project = google_firebase_project.this.project

  # Domains allowed in sign-in redirects and email action links.
  authorized_domains = [
    local.auth_domain,
    "${var.project_id}.web.app",
  ]

  sign_in {
    # One account per email address.
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = true
    }

    phone_number {
      enabled = false
    }
  }

  # Sign-up kill switch: set signup_enabled = false and apply. New sign-ups then fail with
  # ADMIN_ONLY_OPERATION; existing accounts keep working. Users can always delete their own account.
  client {
    permissions {
      disabled_user_signup   = !var.signup_enabled
      disabled_user_deletion = false
    }
  }
}
