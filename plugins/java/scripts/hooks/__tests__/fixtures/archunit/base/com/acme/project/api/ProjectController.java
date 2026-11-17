package com.acme.project.api;

import com.acme.project.domain.Project;

class ProjectController {

    Project load() {
        return Project.reconstitute(1L);
    }

}
