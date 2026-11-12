package com.acme.project.domain;

import org.springframework.stereotype.Component;

@Component
public class Project {

    public static Project rehydrate(Long id) {
        return new Project();
    }

}
