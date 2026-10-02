variable "project_id" {
  description = "The Google Cloud project that holds Recaller's backend."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a project ID: 6 to 30 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "project_name" {
  description = "Display name of the project."
  type        = string
  default     = "Recaller"
}

variable "billing_account" {
  description = "The billing account that pays for the project and holds its budget."
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account))
    error_message = "billing_account must look like 012345-6789AB-CDEF01."
  }
}

variable "region" {
  description = "Region for the database and the bucket. Neither can move once created."
  type        = string
  default     = "us-east1"
}

variable "data_bucket" {
  description = "Name of the bucket for the app's files. Defaults to <project_id>-data."
  type        = string
  default     = null
}

variable "app_api_key_id" {
  description = "ID of the app's API key: the last part of its resource name. The current key's ID is a generated UUID."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.app_api_key_id))
    error_message = "app_api_key_id must be up to 63 lowercase letters, digits or hyphens."
  }
}

variable "email_page_key_id" {
  description = "ID of Firebase's auto-created browser key (\"Browser key (auto created by Firebase)\"), which the email action links carry: the last part of its resource name."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.email_page_key_id))
    error_message = "email_page_key_id must be up to 63 lowercase letters, digits or hyphens."
  }
}

variable "backup_retention_days" {
  description = "How many days each daily Firestore backup is kept."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 98 && floor(var.backup_retention_days) == var.backup_retention_days
    error_message = "backup_retention_days must be a whole number from 1 to 98 (14 weeks, Firestore's limit)."
  }
}

variable "budget_amount" {
  description = "Monthly budget in the billing account's currency. It only sends alerts: nothing is stopped or capped."
  type        = number

  validation {
    condition     = var.budget_amount > 0 && floor(var.budget_amount) == var.budget_amount
    error_message = "budget_amount must be a whole number above zero."
  }
}

variable "budget_currency" {
  description = "The billing account's currency. The budget must use it."
  type        = string

  validation {
    condition     = can(regex("^[A-Z]{3}$", var.budget_currency))
    error_message = "budget_currency must be a three-letter code such as CAD."
  }
}

variable "budget_alert_thresholds" {
  description = "Fractions of the budget at which the billing account's admins and users get an email. Normal spend is about 0.00 a month, so the first one, 10% (1.50 CAD), is meant as an early abuse alarm."
  type        = list(number)
  default     = [0.1, 0.5, 0.9, 1.0]

  validation {
    condition     = length(var.budget_alert_thresholds) > 0 && alltrue([for t in var.budget_alert_thresholds : t > 0])
    error_message = "budget_alert_thresholds needs at least one value, each above zero."
  }
}

variable "signup_enabled" {
  description = "Whether anyone can create a new account. false is the kill switch."
  type        = bool
  default     = true
}
