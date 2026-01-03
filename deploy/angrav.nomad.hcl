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

      env {
        PORT = "3031"
        BROWSER_CDP_ENDPOINT = "http://localhost:9224"
        DEBUG = "angrav:*"
        FALKORDB_HOST = "localhost"
        FALKORDB_PORT = "7687"
        LANGFUSE_HOST = "http://langfuse.100.73.45.27.nip.io"
        LANGFUSE_PUBLIC_KEY = "pk-lf-62de1c00-beee-4519-933c-ae4ce2dafbef"
        LANGFUSE_SECRET_KEY = "sk-lf-825cd051-6ed4-4bb1-8cb2-3576be4d48a2"
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
