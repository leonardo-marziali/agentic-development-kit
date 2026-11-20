package com.acme.project.persistence;

import com.acme.project.domain.ProjectId;
import com.acme.project.mapping.ProjectIdMapper;

// What MapStruct generates: it calls the converters.
class ProjectEntityMapperImpl extends ProjectEntityMapper {

    private final ProjectIdMapper projectIdMapper = new ProjectIdMapper();

    @Override
    public ProjectId toDomain(Long id) {
        return projectIdMapper.toProjectId(id);
    }

}
