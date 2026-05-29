job "angrav-browser" {
  datacenters = ["oci-eu"]
  type        = "service"

  group "browser" {
    count = 1

    network {
      mode = "host"
      port "vnc" {
        static = 5901
      }
      port "cdp" {
        static = 9224
      }
    }

    constraint {
      attribute = "${node.class}"
      value     = "cloud"
    }

    task "angrav-browser" {
      driver = "docker"

      config {
        image        = "localhost:5001/angrav-browser:latest"
        network_mode = "host"
        
        # Add required capabilities for Electron/Chromium in Docker
        cap_add = [
          "NET_ADMIN",
          "SYS_PTRACE"
        ]

        volumes = [
          # Profile data (contains authenticated Google account state)
          "/opt/angrav/profiles/default:/home/angrav/.config/Antigravity",
          # Shared code repository workspace
          "/home/ubuntu/Prods/01pwf:/workspace"
        ]
      }

      env {
        DISPLAY              = ":98"
        TZ                   = "Europe/Prague"
        BROWSER_CDP_ENDPOINT = "http://localhost:9224"
      }

      resources {
        cpu    = 2000 # Browsers are resource-heavy
        memory = 4096 # Limit to 4GB RAM to prevent halvarm exhaustion
      }

      service {
        name = "angrav-browser"
        port = "cdp"

        tags = [
          "angrav",
          "browser",
          "cdp"
        ]

        check {
          name     = "cdp-health"
          type     = "http"
          path     = "/json/version"
          port     = "cdp"
          interval = "10s"
          timeout  = "2s"
        }
      }
    }
  }
}
