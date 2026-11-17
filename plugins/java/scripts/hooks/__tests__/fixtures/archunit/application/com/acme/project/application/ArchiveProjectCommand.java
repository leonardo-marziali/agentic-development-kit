package com.acme.project.application;

import com.acme.project.domain.ProjectId;

public record ArchiveProjectCommand(ProjectId projectId) {

    public static ProjectIdStep builder() {
        return new Builder();
    }

    public interface ProjectIdStep {

        FinalStep projectId(ProjectId projectId);

    }

    public interface FinalStep {

        ArchiveProjectCommand build();

    }

    private static final class Builder implements ProjectIdStep, FinalStep {

        private ProjectId projectId;

        @Override
        public FinalStep projectId(ProjectId projectId) {
            this.projectId = projectId;
            return this;
        }

        @Override
        public ArchiveProjectCommand build() {
            return new ArchiveProjectCommand(projectId);
        }

    }

}
