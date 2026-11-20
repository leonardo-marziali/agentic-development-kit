package com.acme.project.persistence;

import com.acme.project.domain.ProjectId;
import com.acme.project.mapping.ProjectIdMapper;
import org.mapstruct.Mapper;

@Mapper(uses = ProjectIdMapper.class)
abstract class ProjectEntityMapper {

    public abstract ProjectId toDomain(Long id);

}
