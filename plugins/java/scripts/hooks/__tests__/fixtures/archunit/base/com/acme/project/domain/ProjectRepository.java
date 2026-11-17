package com.acme.project.domain;

import com.acme.project.persistence.ProjectEntity;

public interface ProjectRepository {

    void saveProject(Project project);

    ProjectEntity findById(Long id);

}
