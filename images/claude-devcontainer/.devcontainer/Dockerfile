# Claude Code dev container with every agentic-development-kit plugin, a set
# of third-party plugins, and the tooling all of them shell out to.
#
# Node 24 and the non-root `node` user come from the base image; the docker
# and gh CLIs are added afterwards as dev container features (see
# devcontainer.json), so nothing here may depend on them.
FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie

# Links the GHCR package to this repository (and its visibility/permissions).
LABEL org.opencontainers.image.source="https://github.com/leonardo-marziali/agentic-development-kit"
LABEL org.opencontainers.image.description="Dev container with Claude Code, every agentic-development-kit plugin, and the tooling they need."

ARG JDTLS_VERSION=latest
ARG MARKSMAN_VERSION=latest
ARG USERNAME=node

# pipefail so a failed download in `curl ... | bash` fails the build instead
# of piping an empty script into bash.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# The default-jdk symlink gives an arch-independent JAVA_HOME (the JDK's own
# directory name embeds amd64/arm64).
COPY install-tools.sh /tmp/install-tools.sh
RUN JDTLS_VERSION="${JDTLS_VERSION}" MARKSMAN_VERSION="${MARKSMAN_VERSION}" \
      bash /tmp/install-tools.sh \
    && rm /tmp/install-tools.sh \
    && ln -sfn "$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")" /usr/lib/jvm/default-jdk \
    && chown -R "${USERNAME}:${USERNAME}" /opt/jdtls

ENV JAVA_HOME=/usr/lib/jvm/default-jdk

USER ${USERNAME}
ENV PATH="/home/${USERNAME}/.local/bin:/home/${USERNAME}/.local/share/sonarqube-cli/bin:${PATH}"

# Claude Code (native installer, lands in ~/.local/bin) and the SonarQube
# CLI (lands in ~/.local/share/sonarqube-cli/bin).
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && curl -fsSL https://raw.githubusercontent.com/SonarSource/sonarqube-cli/master/user-scripts/install.sh | bash \
    && claude --version \
    && sonar --version

COPY --chown=${USERNAME}:${USERNAME} install-plugins.sh /tmp/install-plugins.sh
RUN bash /tmp/install-plugins.sh && rm /tmp/install-plugins.sh

USER root
