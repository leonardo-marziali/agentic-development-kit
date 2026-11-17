package com.acme.project.application;

import com.acme.project.domain.ProjectId;
import java.util.List;

public interface ProjectQueries {

    String getById(ProjectId projectId);

    List<String> loadAll();

}
