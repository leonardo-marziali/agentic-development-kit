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

ARG CLAUDE_VERSION=stable
ARG JDTLS_VERSION=latest
ARG MARKSMAN_VERSION=latest
ARG SONAR_CLI_VERSION=latest
ARG RUFF_VERSION=latest
ARG MARKETPLACE_REF=
ARG USERNAME=node

# pipefail so a failure anywhere in a pipeline fails the build.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# The install scripts are bind-mounted rather than copied, so nothing from
# the build context is left in the image for a non-root user to modify.
# Every download they make is HTTPS-only and checked (sha256 or OpenPGP
# signature) before it is installed or run.
#
# The default-jdk symlink gives an arch-independent JAVA_HOME (the JDK's own
# directory name embeds amd64/arm64).
RUN --mount=type=bind,target=/tmp/devcontainer \
    JDTLS_VERSION="${JDTLS_VERSION}" \
    MARKSMAN_VERSION="${MARKSMAN_VERSION}" \
    SONAR_CLI_VERSION="${SONAR_CLI_VERSION}" \
    RUFF_VERSION="${RUFF_VERSION}" \
      bash /tmp/devcontainer/install-tools.sh \
    && ln -sfn "$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")" /usr/lib/jvm/default-jdk

ENV JAVA_HOME=/usr/lib/jvm/default-jdk

USER ${USERNAME}
ENV PATH="/home/${USERNAME}/.local/bin:${PATH}"

RUN --mount=type=bind,target=/tmp/devcontainer \
    CLAUDE_VERSION="${CLAUDE_VERSION}" bash /tmp/devcontainer/install-claude.sh \
    && claude --version \
    && sonar --version \
    && MARKETPLACE_REF="${MARKETPLACE_REF}" bash /tmp/devcontainer/install-plugins.sh
