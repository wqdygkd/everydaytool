FROM node:22-slim

WORKDIR /app

COPY service.mjs .

ENV PIKPAK_ENGINE_CONFIG_DIR=/config \
    PIKPAK_DEST=/downloads \
    PIKPAK_ENGINE_PORT=8787

EXPOSE 8787

CMD ["node", "service.mjs"]
