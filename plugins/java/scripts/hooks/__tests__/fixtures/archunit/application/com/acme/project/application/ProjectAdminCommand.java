package com.acme.project.application;

// Its builder returns another command's first step.
public record ProjectAdminCommand(String reason) {

    public static ArchiveProjectCommand.ProjectIdStep builder() {
        return ArchiveProjectCommand.builder();
    }

}
