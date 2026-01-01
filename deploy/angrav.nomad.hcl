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
