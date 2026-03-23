resource "azurerm_resource_group" "main" {
  name     = "ContainerApps"
  location = var.location
}
