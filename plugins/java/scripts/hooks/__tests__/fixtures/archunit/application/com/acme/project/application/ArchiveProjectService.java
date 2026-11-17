package com.acme.project.application;

import org.springframework.stereotype.Service;

@Service
class ArchiveProjectService implements ArchiveProject {

    @Override
    public void execute(ArchiveProjectCommand command) {
        // Loads the project, archives it and hands it back to the repository.
    }

}
