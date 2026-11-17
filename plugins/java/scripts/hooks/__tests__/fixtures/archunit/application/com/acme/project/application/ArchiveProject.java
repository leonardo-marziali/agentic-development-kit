package com.acme.project.application;

import java.util.function.Function;

public interface ArchiveProject {

    void execute(ArchiveProjectCommand command);

    default void execute(Function<ArchiveProjectCommand.ProjectIdStep, ArchiveProjectCommand.FinalStep> command) {
        execute(command.apply(ArchiveProjectCommand.builder()).build());
    }

}
