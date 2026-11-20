package com.acme.project.persistence;

import com.acme.project.application.ProjectQueries;
import com.acme.project.domain.ProjectId;
import com.acme.project.mapping.ProjectIdMapper;
import java.util.List;

// Public, and converts through the MapStruct converter instead of the value object.
public class JpaProjectQueries implements ProjectQueries {

    private final ProjectIdMapper projectIdMapper = new ProjectIdMapper();

    @Override
    public String getById(ProjectId projectId) {
        return projectIdMapper.toProjectId(projectId.value()).toString();
    }

    @Override
    public List<String> loadAll() {
        return List.of();
    }

}
