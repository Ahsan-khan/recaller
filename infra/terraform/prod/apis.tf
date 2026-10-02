resource "google_project_service" "this" {
  for_each = local.services

  project = google_project.this.project_id
  service = each.key

  # Never turn an API off: not on "terraform destroy", and not when it is dropped from the list.
  disable_on_destroy         = false
  disable_dependent_services = false
}
