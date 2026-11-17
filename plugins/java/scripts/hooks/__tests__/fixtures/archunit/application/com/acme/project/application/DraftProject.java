package com.acme.project.application;

import com.acme.project.domain.ProjectId;

public interface DraftProject {

    ProjectId execute(DraftProjectCommand command);

}
