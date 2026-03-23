output "container_app_fqdn" {
  description = "Public hostname of the GuesstAImate backend API"
  value       = azurerm_container_app.main.ingress[0].fqdn
}

# Cross-check these against your GitHub repo secrets after first apply.
output "github_secret_AZURE_CLIENT_ID" {
  description = "Value for the GUESSTAIMATE_AZURE_CLIENT_ID GitHub Actions secret"
  value       = azuread_application.github_deploy.client_id
}

output "github_secret_AZURE_TENANT_ID" {
  description = "Value for the GUESSTAIMATE_AZURE_TENANT_ID GitHub Actions secret"
  value       = var.tenant_id
}

output "github_secret_AZURE_SUBSCRIPTION_ID" {
  description = "Value for the GUESSTAIMATE_AZURE_SUBSCRIPTION_ID GitHub Actions secret"
  value       = var.subscription_id
}
