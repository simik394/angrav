job "angrav" {
  datacenters = ["oci-eu"]
  type        = "service"

  group "server" {
    count = 1

    network {
      mode = "host"
      port "http" {
        static = 3031
      }
    }

    constraint {
      attribute = "${node.class}"
      value     = "cloud"
    }

    task "angrav-server" {
      driver = "docker"

      config {
        image = "ghcr.io/simik394/osobni_wf/angrav:latest"
        network_mode = "host"
      }

      # Vault integration for secrets
      vault {
        policies = ["agents"]
      }

      # Inject secrets from Vault as environment variables
      template {
        data = <<EOF
{{- with secret "secret/data/agents/windmill" }}
WINDMILL_TOKEN={{ .Data.data.token }}
WINDMILL_URL=http://localhost:8000
WINDMILL_WORKSPACE=main
{{- end }}
{{- with secret "secret/data/agents/langfuse" }}
LANGFUSE_PUBLIC_KEY={{ .Data.data.public_key }}
LANGFUSE_SECRET_KEY={{ .Data.data.secret_key }}
LANGFUSE_HOST=http://localhost:3200
{{- end }}
EOF
        destination = "secrets/vault.env"
        env         = true
      }

      env {
        PORT = "3031"
        BROWSER_CDP_ENDPOINT = "http://localhost:9224"
        DEBUG = "angrav:*"
        FALKORDB_HOST = "localhost"
        FALKORDB_PORT = "6379"
      }

      resources {
        cpu    = 200
        memory = 512
      }

      service {
        name = "angrav-server"
        port = "http"
        
        tags = [
          "angrav",
          "api",
          "traefik.enable=true",
          "traefik.http.routers.angrav.rule=Host(`angrav.service.consul`)",
        ]
        
        check {
          name     = "http-health"
          type     = "http"
          path     = "/health"
          interval = "10s"
          timeout  = "2s"
        }
      }
    }
  }
}
