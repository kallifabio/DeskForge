# Dockerfile für den Provisioning-Service
#
# WICHTIG: Dieses Image braucht sowohl provisioning-service/ als auch das
# gemeinsame shared/-Verzeichnis eine Ebene darüber. Deshalb MUSS der
# Build-Kontext das komplette Repository-Wurzelverzeichnis sein, nicht nur
# provisioning-service/:
#
#   cd vdi-toolkit
#   docker build -f provisioning-service/Dockerfile -t vdi-provisioning-service .
#
# Ein Docker-Container sieht außerdem NICHT automatisch den Zertifikats-
# Trust-Store des Host-Systems. Genau das hat im Original-Setup dazu
# geführt, dass der Container Proxmox nicht per HTTPS erreichen konnte,
# obwohl die interne CA auf dem Host längst importiert war. Deshalb wird
# ca.crt hier explizit in den Container-Trust-Store kopiert UND
# zusätzlich per NODE_EXTRA_CA_CERTS an Node.js selbst übergeben.

FROM node:22-slim

WORKDIR /app

COPY provisioning-service/package.json ./
RUN npm install --omit=dev

COPY provisioning-service/src ./src
COPY shared /shared

# Wird beim Start per docker-compose/-v gemountet, z.B.:
#   -v ../ca/ca-output/ca.crt:/certs/ca.crt:ro
#   -v vdi-provisioning-data:/app/data
ENV CA_CERT_PATH=/certs/ca.crt
ENV NODE_EXTRA_CA_CERTS=/certs/ca.crt
ENV STATE_FILE_PATH=/app/data/state.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data

COPY provisioning-service/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
