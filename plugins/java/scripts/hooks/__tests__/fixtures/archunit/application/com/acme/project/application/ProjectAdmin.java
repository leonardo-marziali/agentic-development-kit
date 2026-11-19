package com.acme.project.application;

public interface ProjectAdmin {

    void execute(ProjectAdminCommand command);

    void archive(ArchiveProjectCommand command);

}
