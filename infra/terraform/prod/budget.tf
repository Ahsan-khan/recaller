# Emails the billing account's admins and users as spend passes each threshold of the monthly
# budget, and once the month's forecast passes the whole budget. Alerts only: nothing is stopped or
# capped, and Google's cost data can lag a day, so the kill switches in ../../README.md are what stop
# abuse.
resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "Recaller (${var.project_id})"

  budget_filter {
    projects               = ["projects/${google_project.this.number}"]
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
    calendar_period        = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.budget_amount)
    }
  }

  dynamic "threshold_rules" {
    for_each = var.budget_alert_thresholds
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  # Warns before the money is spent: Google projects the month from the spend so far.
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.this]
}
