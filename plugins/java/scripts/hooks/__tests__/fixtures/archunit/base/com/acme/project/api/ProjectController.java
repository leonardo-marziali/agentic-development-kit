package com.acme.project.api;

import com.acme.project.domain.Project;

class ProjectController {

    Project load() {
        return Project.rehydrate(1L);
    }

}
