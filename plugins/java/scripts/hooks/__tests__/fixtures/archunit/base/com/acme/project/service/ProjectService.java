package com.acme.project.service;

import com.acme.project.domain.Project;
import com.acme.project.persistence.ProjectEntity;

public interface ProjectService {

    void saveProject(Project project);

    ProjectEntity findById(Long id);

}
