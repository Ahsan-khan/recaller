variable "project_id" {
  description = "The Google Cloud project that holds Recaller's backend and its Terraform state."
  type        = string
}

variable "region" {
  description = "Region for the state bucket (the same as the app's data)."
  type        = string
  default     = "us-east1"
}

variable "state_bucket" {
  description = "Name of the state bucket. Defaults to <project_id>-tfstate."
  type        = string
  default     = null
}
