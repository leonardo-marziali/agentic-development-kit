package com.acme.project.service;

import java.util.function.Consumer;

class ArchiveProjectUseCase implements Consumer<String> {

    public void handle(String projectId) {
        Runnable task = () -> helper(projectId);
        task.run();
    }

    @Override
    public void accept(String projectId) {
        handle(projectId);
    }

    private void helper(String projectId) {
    }

}
