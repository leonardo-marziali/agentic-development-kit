package com.acme.project.mapping;

import com.acme.project.domain.ProjectId;

public class ProjectIdMapper {

    public ProjectId toProjectId(Long value) {
        return value == null ? null : new ProjectId(value);
    }

}
