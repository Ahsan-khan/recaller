# The key the desktop app embeds. Its value reaches the app only through the app_config output.
resource "google_apikeys_key" "app" {
  project      = google_project.this.project_id
  name         = var.app_api_key_id
  display_name = "Recaller desktop app"

  restrictions {
    dynamic "api_targets" {
      for_each = local.app_key_services
      content {
        service = api_targets.value
      }
    }
  }

  # Every released app carries this key, so replacing it would break them. To rotate it, see
  # ../../README.md.
  lifecycle {
    prevent_destroy = true

    # An empty api_targets list removes every restriction, opening the key to all Google APIs.
    precondition {
      condition     = length(local.app_key_services) > 0
      error_message = "app_key_services must not be empty: that would leave the app key unrestricted. To block the key, use the kill switches in infra/README.md."
    }
  }

  depends_on = [google_project_service.this]
}

# Firebase's auto-created browser key, adopted on 2026-10-01 (imports.tf). Recaller doesn't use it, but every
# verification and password-reset email does: its link carries this key, and Firebase's action page at
# recaller-cloud.firebaseapp.com/__/auth/action calls Identity Toolkit with it. Firebase created it with 27 APIs;
# it keeps only the sign-in ones (locals.tf). Taking those away too would break every email link.
resource "google_apikeys_key" "email_page" {
  project      = google_project.this.project_id
  name         = var.email_page_key_id
  display_name = "Browser key (auto created by Firebase)"

  restrictions {
    dynamic "api_targets" {
      for_each = local.email_page_key_services
      content {
        service = api_targets.value
      }
    }
  }

  # Deleting it would break the links in emails already sent, and Firebase may make a new one.
  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = length(local.email_page_key_services) > 0
      error_message = "email_page_key_services must not be empty: that would leave the key unrestricted."
    }
  }

  depends_on = [google_project_service.this]
}
