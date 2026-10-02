# One-time adoption of Firebase's auto-created browser key (apikey.tf, google_apikeys_key.email_page). After the
# apply that imports it, delete this file: a plan then still says "No changes".
import {
  to = google_apikeys_key.email_page
  id = "projects/${var.project_id}/locations/global/keys/${var.email_page_key_id}"
}
