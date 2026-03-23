terraform {
  backend "azurerm" {
    # Update storage_account_name after running the bootstrap script in README.md
    resource_group_name  = "tfstate-rg"
    storage_account_name = "tfguesstaimate"
    container_name       = "tfstate"
    key                  = "guesstaimate.tfstate"
  }
}
